const Appointment = require("../models/Appointment");

const create = (payload) => Appointment.create(payload);

const findById = (id) =>
  Appointment.findById(id)
    .populate("patient", "name email phone gender dateOfBirth")
    .populate("doctor", "name email doctorProfile.specialization doctorProfile.hospitalName")
    .exec();

const paginate = async (filter, pagination, sort = { scheduledFor: -1 }) => {
  const [appointments, totalItems] = await Promise.all([
    Appointment.find(filter)
      .populate("patient", "name email phone gender dateOfBirth")
      .populate("doctor", "name email doctorProfile.specialization doctorProfile.hospitalName")
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    Appointment.countDocuments(filter),
  ]);

  return { appointments, totalItems };
};

const updateById = (id, updates) =>
  Appointment.findByIdAndUpdate(id, updates, { new: true, runValidators: true })
    .populate("patient", "name email")
    .populate("doctor", "name email doctorProfile.specialization")
    .exec();

/**
 * Includes `meeting.roomId`, which the schema hides. Only the join flow should
 * call this: the room name is the entire access control on a Jitsi call, so it
 * must not travel with an ordinary appointment read.
 */
const findByIdWithMeeting = (id) => Appointment.findById(id).select("+meeting.roomId").exec();

/** Atomic so two participants joining at once cannot lose one another's count. */
const incrementParticipants = (id) =>
  Appointment.findByIdAndUpdate(id, { $inc: { "meeting.participantsJoined": 1 } }).exec();

const countUpcoming = (filter) =>
  Appointment.countDocuments({
    ...filter,
    scheduledFor: { $gte: new Date() },
    status: { $in: ["requested", "confirmed"] },
  });

module.exports = {
  countUpcoming,
  create,
  findById,
  findByIdWithMeeting,
  incrementParticipants,
  paginate,
  updateById,
};
