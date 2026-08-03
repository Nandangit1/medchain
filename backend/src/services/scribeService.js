const crypto = require("crypto");

const Anthropic = require("@anthropic-ai/sdk");

const { env } = require("../config/env");
const logger = require("../config/logger");
const AppError = require("../utils/AppError");

/**
 * Ambient Scribe.
 *
 * Turns a consultation transcript into a structured SOAP note so the clinician
 * reviews and signs rather than types. Published studies put the saving at
 * around 20% of note-taking time per appointment.
 *
 * THE RULE THIS SERVICE EXISTS TO ENFORCE: **AI drafts, the clinician signs.**
 *
 * Nothing here writes to a patient's record. It returns a draft; only an
 * explicit signing action by the treating doctor turns that draft into a
 * Diagnosis. That boundary is the difference between a tool a clinician would
 * use and one no clinician would touch, so it is enforced in the controller
 * rather than left to the caller's good intentions.
 *
 * Two drivers, chosen by SCRIBE_DRIVER, following the same factory shape as
 * the IPFS and ABHA layers:
 *
 *   mock    Deterministic extraction from the transcript. No API key, no
 *           network, works offline. Good enough to demonstrate the flow, and
 *           honest about being a stub -- it never invents clinical content.
 *   claude  Real structuring via the Anthropic API. Needs ANTHROPIC_API_KEY.
 */

const SOAP_SCHEMA = {
  type: "object",
  properties: {
    subjective: {
      type: "string",
      description: "What the patient reports: symptoms, history, concerns, in their own framing.",
    },
    objective: {
      type: "string",
      description:
        "Observable findings stated in the consultation: vitals, examination findings, test results. Empty if none were stated.",
    },
    assessment: {
      type: "string",
      description: "The clinician's stated impression or working diagnosis.",
    },
    plan: {
      type: "string",
      description: "Next steps: investigations, prescriptions, referrals, follow-up.",
    },
    summary: {
      type: "string",
      description: "One sentence a colleague could read to understand the encounter.",
    },
    icdCode: {
      type: "string",
      description:
        "ICD-10 code for the assessment, if one is clearly implied. Empty string when it is not.",
    },
    severity: {
      type: "string",
      // Matches the Diagnosis model's vocabulary exactly, plus "unspecified"
      // for the common case where the transcript implies no severity at all.
      // A scribe that invents its own scale produces notes that will not save.
      enum: ["low", "moderate", "high", "critical", "unspecified"],
    },
    followUpInDays: {
      type: "integer",
      description: "Days until follow-up if one was agreed, otherwise 0.",
    },
  },
  required: [
    "subjective",
    "objective",
    "assessment",
    "plan",
    "summary",
    "icdCode",
    "severity",
    "followUpInDays",
  ],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a clinical scribe. You convert a doctor-patient consultation transcript into a SOAP note.

Rules that matter more than completeness:
- Record only what the transcript states. Never infer a diagnosis, a dose, or a
  finding that was not said aloud. An empty field is correct when nothing was said.
- Do not add advice, warnings, or clinical judgement of your own. You are
  transcribing structure, not practising medicine.
- Preserve the clinician's own wording for the assessment and plan wherever you can.
- Only give an ICD-10 code when the assessment clearly implies one. Otherwise
  return an empty string. A guessed code is worse than no code.

A doctor reviews and signs everything you produce, so an incomplete note is
recoverable and an invented one is not.`;

// --- Drivers ---------------------------------------------------------------

/**
 * Offline driver. Splits the transcript by speaker and buckets each line into
 * the SOAP section its speaker implies. Crude on purpose: it extracts, it does
 * not generate, so it can never fabricate a clinical finding.
 */
const mockDriver = {
  name: "mock",

  async structure({ transcript }) {
    const lines = transcript
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const patientLines = [];
    const doctorLines = [];

    lines.forEach((line) => {
      const match = line.match(/^(patient|doctor|dr\.?)\s*[:-]\s*(.*)$/i);

      if (!match) {
        doctorLines.push(line);
        return;
      }

      if (/^patient$/i.test(match[1])) {
        patientLines.push(match[2]);
      } else {
        doctorLines.push(match[2]);
      }
    });

    // The clinician's closing remarks are, in practice, the plan.
    const planLines = doctorLines.slice(-2);
    const assessmentLines = doctorLines.slice(0, -2);

    return {
      subjective: patientLines.join(" "),
      objective: "",
      assessment: assessmentLines.join(" "),
      plan: planLines.join(" "),
      summary: patientLines[0] ? `Consultation regarding: ${patientLines[0]}` : "Consultation",
      icdCode: "",
      severity: "unspecified",
      followUpInDays: /follow[ -]?up/i.test(transcript) ? 7 : 0,
      // Stated in the payload, not just in a comment, so a reviewer of the
      // draft can see it was not produced by a clinical model.
      driverNote: "Drafted offline by rule-based extraction, not by a language model.",
    };
  },
};

/**
 * Real driver. Structured outputs constrain the reply to SOAP_SCHEMA, so the
 * response is schema-valid without a parse-and-hope step.
 */
const claudeDriver = {
  name: "claude",

  async structure({ transcript, context }) {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: SOAP_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `${context ? `Context: ${context}\n\n` : ""}Transcript:\n\n${transcript}`,
        },
      ],
    });

    const block = response.content.find((entry) => entry.type === "text");

    if (!block) {
      throw new AppError("The scribe returned no note.", 502);
    }

    return JSON.parse(block.text);
  },
};

const driver = env.SCRIBE_DRIVER === "claude" && env.ANTHROPIC_API_KEY ? claudeDriver : mockDriver;

// --- Public API ------------------------------------------------------------

const driverName = () => driver.name;

/**
 * @returns a DRAFT. It is not persisted and is not a medical record until a
 *          doctor signs it.
 */
const draftFromTranscript = async ({ transcript, context }) => {
  if (!transcript || transcript.trim().length < 20) {
    throw new AppError("The transcript is too short to summarise.", 400);
  }

  const note = await driver.structure({ transcript, context });

  /**
   * The transcript is hashed the same way a medical file is, so the note a
   * doctor signs can later be shown to correspond to the conversation it came
   * from -- and to no other. The hash is over the transcript, never the audio.
   */
  const transcriptHash = crypto.createHash("sha256").update(transcript, "utf8").digest("hex");

  logger.info("Scribe draft produced", {
    driver: driver.name,
    transcriptHash,
    transcriptLength: transcript.length,
  });

  return {
    ...note,
    transcriptHash,
    driver: driver.name,
    draftedAt: new Date(),
    // Repeated in the payload so a client cannot render this as a signed note
    // by accident.
    status: "draft",
    requiresClinicianSignature: true,
  };
};

module.exports = { SOAP_SCHEMA, draftFromTranscript, driverName };
