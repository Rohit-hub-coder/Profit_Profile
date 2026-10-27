const { Schema } = require("mongoose");

const PosSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", index: true },
  product: String,
  name: String,
  qty: Number,
  avg: Number,
  price: Number,
  net: String,
  day: String,
  isLoss: Boolean,
});

module.exports = { PosSchema };
