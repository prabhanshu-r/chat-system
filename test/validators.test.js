const test = require("node:test");
const assert = require("node:assert/strict");
const { isUuid, normalizeEmail, validateRegistration } = require("../validators");

test("normalizes email addresses", () => {
  assert.equal(normalizeEmail("  Student@Example.edu "), "student@example.edu");
});

test("accepts valid account details and trims the display name", () => {
  const result = validateRegistration({
    name: "  Alex Student ",
    email: "ALEX@example.edu",
    password: "my secure password",
  });

  assert.deepEqual(result, {
    ok: true,
    name: "Alex Student",
    email: "alex@example.edu",
    password: "my secure password",
  });
});

test("rejects passwords that are too short or too long for bcrypt", () => {
  assert.equal(validateRegistration({
    name: "Alex Student",
    email: "alex@example.edu",
    password: "short",
  }).ok, false);

  assert.equal(validateRegistration({
    name: "Alex Student",
    email: "alex@example.edu",
    password: "x".repeat(73),
  }).ok, false);
});

test("rejects missing and malformed account fields", () => {
  assert.equal(validateRegistration({}).ok, false);
  assert.equal(validateRegistration({
    name: "A",
    email: "not-an-email",
    password: "long enough password",
  }).ok, false);
});

test("validates UUIDs before using user and conversation identifiers", () => {
  assert.equal(isUuid("b32f3ab7-083c-44c9-9822-8b962daf2ae7"), true);
  assert.equal(isUuid("not-a-uuid"), false);
});
