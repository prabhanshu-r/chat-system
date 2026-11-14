const test = require("node:test");
const assert = require("node:assert/strict");
const { getGoogleProfile, isUuid, normalizeEmail, validateRegistration } = require("../validators");

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

test("accepts verified Google profiles and normalizes the account identity", () => {
  assert.deepEqual(
    getGoogleProfile({
      id: "B32F3AB7-083C-44C9-9822-8B962DAF2AE7",
      email: "  Alex@Gmail.com ",
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      app_metadata: { providers: ["google"] },
      user_metadata: { full_name: "Alex Student" },
    }),
    {
      id: "b32f3ab7-083c-44c9-9822-8b962daf2ae7",
      name: "Alex Student",
      email: "alex@gmail.com",
    },
  );
});

test("rejects unverified and non-Google Supabase profiles", () => {
  const profile = {
    id: "b32f3ab7-083c-44c9-9822-8b962daf2ae7",
    email: "alex@gmail.com",
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    app_metadata: { providers: ["email"] },
    user_metadata: { name: "Alex" },
  };

  assert.equal(getGoogleProfile(profile), null);
  assert.equal(
    getGoogleProfile({ ...profile, app_metadata: { providers: ["google"] }, email_confirmed_at: null }),
    null,
  );
});
