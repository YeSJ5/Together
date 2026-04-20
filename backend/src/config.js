require("dotenv").config();

const PORT = Number(process.env.PORT) || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const ALLOWED_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? "*"
    : CLIENT_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

module.exports = {
  ALLOWED_ORIGINS,
  CLIENT_ORIGIN,
  PORT
};
