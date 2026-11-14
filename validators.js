const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getGoogleProfile(user) {
  const id = typeof user?.id === "string" ? user.id.toLowerCase() : "";
  const email = normalizeEmail(user?.email);
  const providers = user?.app_metadata?.providers;
  const isGoogleUser =
    user?.app_metadata?.provider === "google" ||
    (Array.isArray(providers) && providers.includes("google"));

  if (
    !isUuid(id) ||
    !email ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email) ||
    !user.email_confirmed_at ||
    !isGoogleUser
  ) {
    return null;
  }

  const metadata = user.user_metadata || {};
  const displayName = [metadata.full_name, metadata.name].find(
    (value) => typeof value === "string" && value.trim(),
  );
  const name = (displayName || email.split("@")[0]).trim().slice(0, 60);
  return { id, name, email };
}

function validateRegistration(payload) {
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const email = normalizeEmail(payload?.email);
  const password = typeof payload?.password === "string" ? payload.password : "";

  if (name.length < 2 || name.length > 60) {
    return { ok: false, error: "Name must be between 2 and 60 characters." };
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const passwordBytes = Buffer.byteLength(password, "utf8");
  if (passwordBytes < 10 || passwordBytes > 72) {
    return { ok: false, error: "Password must be 10–72 bytes long." };
  }

  return { ok: true, name, email, password };
}

module.exports = { getGoogleProfile, isUuid, normalizeEmail, validateRegistration };
