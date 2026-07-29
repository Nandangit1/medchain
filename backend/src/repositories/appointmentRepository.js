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

const countUpcoming = (filter) =>
  Appointment.countDocuments({
    ...filter,
    scheduledFor: { $gte: new Date() },
    status: { $in: ["requested", "confirmed"] },
  });

module.exports = { countUpcoming, create, findById, paginate, updateById };
