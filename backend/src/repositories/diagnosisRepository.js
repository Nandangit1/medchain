const Diagnosis = require("../models/Diagnosis");

const create = (payload) => Diagnosis.create(payload);

const findById = (id) => Diagnosis.findById(id).exec();

const findByRecord = (recordId) =>
  Diagnosis.find({ record: recordId })
    .populate("doctor", "name email doctorProfile.specialization")
    .sort({ createdAt: -1 })
    .exec();

const paginate = async (filter, pagination) => {
  const [diagnoses, totalItems] = await Promise.all([
    Diagnosis.find(filter)
      .populate("doctor", "name email doctorProfile.specialization")
      .populate("patient", "name email")
      .populate("record", "title recordType")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .exec(),
    Diagnosis.countDocuments(filter),
  ]);

  return { diagnoses, totalItems };
};

const updateById = (id, updates) =>
  Diagnosis.findByIdAndUpdate(id, updates, { new: true, runValidators: true }).exec();

module.exports = { create, findById, findByRecord, paginate, updateById };
