const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Contract tests for TelemedicineRecords.
 *
 * These are written against the SECURITY PROPERTIES of the system rather than
 * only its happy path: an unverified doctor must never gain access, a revoked
 * grant must stop working immediately, an expired grant must lapse on its own,
 * and nobody but the patient may hand out access.
 */
describe("TelemedicineRecords", () => {
  const CID = "bafkreiabc123def456ghi789jkl012mno345pqr678stu901vwx234yz";
  const RECORD_TYPE_LAB = 1;

  const hashOf = (text) => ethers.keccak256(ethers.toUtf8Bytes(text));

  async function deployFixture() {
    const [admin, registrar, patient, otherPatient, doctor, otherDoctor, outsider] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("TelemedicineRecords");
    const contract = await Factory.deploy(admin.address, registrar.address);
    await contract.waitForDeployment();

    return {
      contract,
      admin,
      registrar,
      patient,
      otherPatient,
      doctor,
      otherDoctor,
      outsider,
    };
  }

  /** Registers a patient and a verified doctor, and anchors one record. */
  async function seededFixture() {
    const ctx = await deployFixture();
    const { contract, registrar, admin, patient, otherPatient, doctor, otherDoctor } = ctx;

    await contract.connect(registrar).registerPatient(patient.address, hashOf("patient-1"));
    await contract.connect(registrar).registerPatient(otherPatient.address, hashOf("patient-2"));
    await contract.connect(registrar).registerDoctor(doctor.address, hashOf("doctor-1"));
    await contract.connect(registrar).registerDoctor(otherDoctor.address, hashOf("doctor-2"));

    await contract.connect(admin).verifyDoctor(doctor.address);
    // otherDoctor is deliberately left unverified.

    await contract
      .connect(registrar)
      .anchorRecord(patient.address, hashOf("report-A"), CID, RECORD_TYPE_LAB);

    return { ...ctx, recordId: 1n };
  }

  // -------------------------------------------------------------------
  describe("Deployment", () => {
    it("assigns roles to the intended accounts", async () => {
      const { contract, admin, registrar } = await loadFixture(deployFixture);

      expect(await contract.hasRole(await contract.ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await contract.hasRole(await contract.REGISTRAR_ROLE(), registrar.address)).to.equal(
        true
      );
      expect(await contract.hasRole(await contract.CUSTODIAN_ROLE(), registrar.address)).to.equal(
        true
      );
    });

    it("rejects a zero address at construction", async () => {
      const [admin] = await ethers.getSigners();
      const Factory = await ethers.getContractFactory("TelemedicineRecords");

      await expect(
        Factory.deploy(ethers.ZeroAddress, admin.address)
      ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    });
  });

  // -------------------------------------------------------------------
  describe("Registration", () => {
    it("registers a patient and emits the event", async () => {
      const { contract, registrar, patient } = await loadFixture(deployFixture);
      const ref = hashOf("patient-1");

      await expect(contract.connect(registrar).registerPatient(patient.address, ref))
        .to.emit(contract, "PatientRegistered")
        .withArgs(patient.address, ref, anyUint());

      const participant = await contract.getParticipant(patient.address);
      expect(participant.role).to.equal(1); // Patient
      expect(participant.active).to.equal(true);
    });

    it("blocks a non-registrar from registering anyone", async () => {
      const { contract, outsider, patient } = await loadFixture(deployFixture);

      await expect(
        contract.connect(outsider).registerPatient(patient.address, hashOf("x"))
      ).to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount");
    });

    it("rejects double registration", async () => {
      const { contract, registrar, patient } = await loadFixture(deployFixture);

      await contract.connect(registrar).registerPatient(patient.address, hashOf("p"));

      await expect(
        contract.connect(registrar).registerPatient(patient.address, hashOf("p"))
      ).to.be.revertedWithCustomError(contract, "AlreadyRegistered");
    });

    it("only an admin may verify a doctor", async () => {
      const { contract, registrar, doctor, outsider } = await loadFixture(deployFixture);

      await contract.connect(registrar).registerDoctor(doctor.address, hashOf("d"));

      await expect(
        contract.connect(outsider).verifyDoctor(doctor.address)
      ).to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount");
    });

    it("refuses to verify a patient as a doctor", async () => {
      const { contract, registrar, admin, patient } = await loadFixture(deployFixture);

      await contract.connect(registrar).registerPatient(patient.address, hashOf("p"));

      await expect(
        contract.connect(admin).verifyDoctor(patient.address)
      ).to.be.revertedWithCustomError(contract, "NotADoctor");
    });
  });

  // -------------------------------------------------------------------
  describe("Anchoring records", () => {
    it("anchors a record and returns a 1-based id", async () => {
      const { contract, registrar, patient } = await loadFixture(seededFixture);
      const hash = hashOf("report-B");

      await expect(
        contract.connect(registrar).anchorRecord(patient.address, hash, CID, RECORD_TYPE_LAB)
      )
        .to.emit(contract, "RecordAnchored")
        .withArgs(2n, patient.address, registrar.address, hash, CID, RECORD_TYPE_LAB, anyUint());

      expect(await contract.recordCount()).to.equal(2n);
    });

    it("stores the hash and CID exactly as supplied", async () => {
      const { contract, recordId, patient } = await loadFixture(seededFixture);
      const record = await contract.getRecord(recordId);

      expect(record.patient).to.equal(patient.address);
      expect(record.contentHash).to.equal(hashOf("report-A"));
      expect(record.cid).to.equal(CID);
      expect(record.active).to.equal(true);
    });

    it("rejects a duplicate content hash for the same patient", async () => {
      const { contract, registrar, patient } = await loadFixture(seededFixture);

      await expect(
        contract
          .connect(registrar)
          .anchorRecord(patient.address, hashOf("report-A"), CID, RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "DuplicateContentHash");
    });

    it("allows two patients to anchor the same hash", async () => {
      const { contract, registrar, otherPatient } = await loadFixture(seededFixture);

      await expect(
        contract
          .connect(registrar)
          .anchorRecord(otherPatient.address, hashOf("report-A"), CID, RECORD_TYPE_LAB)
      ).to.emit(contract, "RecordAnchored");
    });

    it("rejects an empty CID and a zero hash", async () => {
      const { contract, registrar, patient } = await loadFixture(seededFixture);

      await expect(
        contract.connect(registrar).anchorRecord(patient.address, hashOf("x"), "", RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "EmptyCid");

      await expect(
        contract
          .connect(registrar)
          .anchorRecord(patient.address, ethers.ZeroHash, CID, RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "ZeroHash");
    });

    it("refuses to anchor for an unregistered address", async () => {
      const { contract, registrar, outsider } = await loadFixture(seededFixture);

      await expect(
        contract.connect(registrar).anchorRecord(outsider.address, hashOf("x"), CID, RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "NotRegistered");
    });

    it("refuses to anchor a record owned by a doctor", async () => {
      const { contract, registrar, doctor } = await loadFixture(seededFixture);

      await expect(
        contract.connect(registrar).anchorRecord(doctor.address, hashOf("x"), CID, RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "NotAPatient");
    });

    it("blocks anchoring by a non-registrar", async () => {
      const { contract, patient } = await loadFixture(seededFixture);

      await expect(
        contract.connect(patient).anchorRecord(patient.address, hashOf("x"), CID, RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount");
    });
  });

  // -------------------------------------------------------------------
  describe("Access grants", () => {
    it("lets the patient grant a verified doctor access", async () => {
      const { contract, patient, doctor, recordId } = await loadFixture(seededFixture);

      await expect(contract.connect(patient).grantAccess(recordId, doctor.address, 0))
        .to.emit(contract, "AccessGranted")
        .withArgs(recordId, patient.address, doctor.address, 0, false, anyUint());

      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(true);
    });

    it("REFUSES to grant access to an unverified doctor", async () => {
      const { contract, patient, otherDoctor, recordId } = await loadFixture(seededFixture);

      await expect(
        contract.connect(patient).grantAccess(recordId, otherDoctor.address, 0)
      ).to.be.revertedWithCustomError(contract, "DoctorNotVerified");
    });

    it("REFUSES to let anyone but the owner grant access", async () => {
      const { contract, otherPatient, doctor, outsider, recordId } = await loadFixture(
        seededFixture
      );

      await expect(
        contract.connect(otherPatient).grantAccess(recordId, doctor.address, 0)
      ).to.be.revertedWithCustomError(contract, "NotRecordOwner");

      await expect(
        contract.connect(outsider).grantAccess(recordId, doctor.address, 0)
      ).to.be.revertedWithCustomError(contract, "NotRecordOwner");
    });

    it("refuses to grant to a patient or to self", async () => {
      const { contract, patient, otherPatient, recordId } = await loadFixture(seededFixture);

      await expect(
        contract.connect(patient).grantAccess(recordId, otherPatient.address, 0)
      ).to.be.revertedWithCustomError(contract, "NotADoctor");

      await expect(
        contract.connect(patient).grantAccess(recordId, patient.address, 0)
      ).to.be.revertedWithCustomError(contract, "CannotGrantToSelf");
    });

    it("rejects an expiry that is already in the past", async () => {
      const { contract, patient, doctor, recordId } = await loadFixture(seededFixture);
      const past = (await time.latest()) - 60;

      await expect(
        contract.connect(patient).grantAccess(recordId, doctor.address, past)
      ).to.be.revertedWithCustomError(contract, "ExpiryInThePast");
    });

    it("expires a time-limited grant without anyone calling revoke", async () => {
      const { contract, patient, doctor, recordId } = await loadFixture(seededFixture);
      const expiresAt = (await time.latest()) + 3600;

      await contract.connect(patient).grantAccess(recordId, doctor.address, expiresAt);
      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(true);

      await time.increaseTo(expiresAt + 1);

      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(false);
    });

    it("revokes access immediately", async () => {
      const { contract, patient, doctor, recordId } = await loadFixture(seededFixture);

      await contract.connect(patient).grantAccess(recordId, doctor.address, 0);

      await expect(contract.connect(patient).revokeAccess(recordId, doctor.address))
        .to.emit(contract, "AccessRevoked")
        .withArgs(recordId, patient.address, doctor.address, anyUint());

      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(false);
    });

    it("stops access the moment a doctor's verification is withdrawn", async () => {
      const { contract, admin, patient, doctor, recordId } = await loadFixture(seededFixture);

      await contract.connect(patient).grantAccess(recordId, doctor.address, 0);
      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(true);

      await contract.connect(admin).revokeDoctorVerification(doctor.address);

      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(false);
    });

    it("stops access when the record is deactivated", async () => {
      const { contract, patient, doctor, recordId } = await loadFixture(seededFixture);

      await contract.connect(patient).grantAccess(recordId, doctor.address, 0);
      await contract.connect(patient).deactivateRecord(recordId);

      expect(await contract.hasAccess(recordId, doctor.address)).to.equal(false);
    });

    it("always grants the owning patient access to their own record", async () => {
      const { contract, patient, recordId } = await loadFixture(seededFixture);

      expect(await contract.hasAccess(recordId, patient.address)).to.equal(true);
    });

    it("returns false rather than reverting for an unknown record", async () => {
      const { contract, doctor } = await loadFixture(seededFixture);

      expect(await contract.hasAccess(9999n, doctor.address)).to.equal(false);
    });
  });

  // -------------------------------------------------------------------
  describe("Custodial grants", () => {
    it("flags a custodial grant distinctly in the audit trail", async () => {
      const { contract, registrar, patient, doctor, recordId } = await loadFixture(seededFixture);

      await expect(contract.connect(registrar).grantAccessFor(recordId, doctor.address, 0))
        .to.emit(contract, "AccessGranted")
        .withArgs(recordId, patient.address, doctor.address, 0, true, anyUint());
    });

    it("stops working once CUSTODIAN_ROLE is revoked", async () => {
      const { contract, admin, registrar, doctor, recordId } = await loadFixture(seededFixture);

      await contract
        .connect(admin)
        .revokeRole(await contract.CUSTODIAN_ROLE(), registrar.address);

      await expect(
        contract.connect(registrar).grantAccessFor(recordId, doctor.address, 0)
      ).to.be.revertedWithCustomError(contract, "AccessControlUnauthorizedAccount");
    });
  });

  // -------------------------------------------------------------------
  describe("Access logging", () => {
    it("logs a legitimate read", async () => {
      const { contract, registrar, patient, doctor, recordId } = await loadFixture(seededFixture);

      await contract.connect(patient).grantAccess(recordId, doctor.address, 0);

      await expect(contract.connect(registrar).logAccess(recordId, doctor.address))
        .to.emit(contract, "AccessLogged")
        .withArgs(recordId, doctor.address, anyUint());
    });

    it("cannot be forged for a viewer who was never granted access", async () => {
      const { contract, registrar, outsider, recordId } = await loadFixture(seededFixture);

      await expect(
        contract.connect(registrar).logAccess(recordId, outsider.address)
      ).to.be.revertedWithCustomError(contract, "AccessNotGranted");
    });
  });

  // -------------------------------------------------------------------
  describe("Integrity verification", () => {
    it("confirms a matching document hash", async () => {
      const { contract, recordId } = await loadFixture(seededFixture);

      expect(await contract.verifyRecordIntegrity(recordId, hashOf("report-A"))).to.equal(true);
    });

    it("rejects a tampered document hash", async () => {
      const { contract, recordId } = await loadFixture(seededFixture);

      expect(await contract.verifyRecordIntegrity(recordId, hashOf("report-A-tampered"))).to.equal(
        false
      );
    });

    it("reverts for a record that does not exist", async () => {
      const { contract } = await loadFixture(seededFixture);

      await expect(
        contract.verifyRecordIntegrity(4242n, hashOf("x"))
      ).to.be.revertedWithCustomError(contract, "RecordNotFound");
    });
  });

  // -------------------------------------------------------------------
  describe("Emergency stop", () => {
    it("blocks anchoring while paused and resumes after unpause", async () => {
      const { contract, admin, registrar, patient } = await loadFixture(seededFixture);

      await contract.connect(admin).pause();

      await expect(
        contract.connect(registrar).anchorRecord(patient.address, hashOf("y"), CID, RECORD_TYPE_LAB)
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");

      await contract.connect(admin).unpause();

      await expect(
        contract.connect(registrar).anchorRecord(patient.address, hashOf("y"), CID, RECORD_TYPE_LAB)
      ).to.emit(contract, "RecordAnchored");
    });

    it("still allows revocation while paused", async () => {
      const { contract, admin, patient, doctor, recordId } = await loadFixture(seededFixture);

      await contract.connect(patient).grantAccess(recordId, doctor.address, 0);
      await contract.connect(admin).pause();

      // Withdrawing consent must never be blocked by an operational pause.
      await expect(contract.connect(patient).revokeAccess(recordId, doctor.address)).to.emit(
        contract,
        "AccessRevoked"
      );
    });

    it("only an admin can pause", async () => {
      const { contract, outsider } = await loadFixture(seededFixture);

      await expect(contract.connect(outsider).pause()).to.be.revertedWithCustomError(
        contract,
        "AccessControlUnauthorizedAccount"
      );
    });
  });

  // -------------------------------------------------------------------
  describe("Views", () => {
    it("lists a patient's record ids", async () => {
      const { contract, registrar, patient, recordId } = await loadFixture(seededFixture);

      await contract
        .connect(registrar)
        .anchorRecord(patient.address, hashOf("report-B"), CID, RECORD_TYPE_LAB);

      const ids = await contract.getPatientRecordIds(patient.address);
      expect(ids).to.deep.equal([recordId, 2n]);
    });

    it("reports verified-doctor status correctly", async () => {
      const { contract, doctor, otherDoctor, patient } = await loadFixture(seededFixture);

      expect(await contract.isVerifiedDoctor(doctor.address)).to.equal(true);
      expect(await contract.isVerifiedDoctor(otherDoctor.address)).to.equal(false);
      expect(await contract.isVerifiedDoctor(patient.address)).to.equal(false);
    });
  });
});

/** Matches any uint — used for block timestamps we cannot predict exactly. */
function anyUint() {
  const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
  return anyValue;
}
