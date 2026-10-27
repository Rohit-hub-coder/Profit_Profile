const { Schema } = require("mongoose");

const OrdersSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", index: true },
  name: String,
  qty: Number,
  price: Number,
  mode: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = { OrdersSchema };
