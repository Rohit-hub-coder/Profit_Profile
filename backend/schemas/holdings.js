const { Schema } = require("mongoose");

const HoldingsSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", index: true },
  name: String,
  qty: Number,
  avg: Number,
  price: Number,
  net: String,
  day: String,
  isLoss: Boolean,
});

module.exports = { HoldingsSchema };
