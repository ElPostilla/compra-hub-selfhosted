const express = require("express");
const { upsertUser } = require("../db");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
    firstName: req.user.firstName,
    lastName: req.user.lastName,
    accountConsoleUrl: `${process.env.OIDC_ISSUER}/account/`,
  });
}));

module.exports = router;
