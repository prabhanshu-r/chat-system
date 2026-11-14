const API_BASE = (window.CHAT_CONFIG?.apiUrl || window.location.origin).replace(/\/+$/, "");
const socket = io(API_BASE, { autoConnect: false });
const supabaseClient =
  window.supabase && window.CHAT_CONFIG?.supabaseUrl && window.CHAT_CONFIG?.supabaseAnonKey
    ? window.supabase.createClient(
        window.CHAT_CONFIG.supabaseUrl,
        window.CHAT_CONFIG.supabaseAnonKey,
      )
    : null;

const state = {
  token: sessionStorage.getItem("orbit-chat-token"),
  user: null,
  conversations: [],
  activeConversationId: null,
  activeFilter: "all",
  search: "",
  newestFirst: true,
  authMode: "login",
  onlineUsers: new Set(),
  selectedGroupUsers: new Set(),
};

const authScreen = document.querySelector("#auth-screen");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const appShell = document.querySelector("#app-shell");
const conversationList = document.querySelector("#conversation-list");
const chatSearch = document.querySelector("#chat-search");
const messageArea = document.querySelector("#message-area");
const messageList = document.querySelector("#message-list");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const composerWrap = document.querySelector("#composer-wrap");
const connectionStatus = document.querySelector("#connection-status");
const conversationDialog = document.querySelector("#conversation-dialog");
const conversationError = document.querySelector("#conversation-error");
const userResults = document.querySelector("#user-results");
const groupUserResults = document.querySelector("#group-user-results");
const toast = document.querySelector("#toast");

let callController;
let toastTimeout;
let userSearchSequence = 0;
const avatarColors = ["avatar-rose", "avatar-teal", "avatar-violet", "avatar-gold", "avatar-blue"];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Could not reach the chat server. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The chat server returned an unreadable response.");
  }
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function getInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function getAvatarColor(id, isGroup = false) {
  if (isGroup) return "avatar-teal avatar-group";
  let hash = 0;
  for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return avatarColors[hash % avatarColors.length];
}

function formatTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function updateConnectionStatus(connected) {
  connectionStatus.classList.toggle("is-offline", !connected);
  connectionStatus.lastChild.textContent = connected ? " Connected" : " Reconnecting...";
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  const nameField = document.querySelector("#auth-name-field");
  nameField.hidden = !isRegister;
  document.querySelector("#auth-name").required = isRegister;
  document.querySelector("#auth-password").autocomplete = isRegister ? "new-password" : "current-password";
  document.querySelector("#auth-title").textContent = isRegister ? "Create your account" : "Welcome back";
  document.querySelector("#auth-description").textContent = isRegister
    ? "Use your name, email, and a password to get started."
    : "Sign in to pick up where you left off.";
  document.querySelector("#auth-submit").textContent = isRegister ? "Create account" : "Sign in";
  document.querySelector("#auth-switch-label").textContent = isRegister
    ? "Already have an account?"
    : "New to Safe Chat?";
  document.querySelector("#auth-toggle").textContent = isRegister ? "Sign in" : "Create an account";
  authError.textContent = "";
}

function showAuth() {
  appShell.hidden = true;
  authScreen.hidden = false;
  setAuthMode("login");
}

function saveAuth(result) {
  state.token = result.token;
  state.user = result.user;
  sessionStorage.setItem("orbit-chat-token", result.token);
  document.querySelector("#auth-password").value = "";
  document.querySelector("#auth-name").value = "";
}

async function signOut() {
  callController?.endCurrentCall("signed out");
  socket.disconnect();
  await clearGoogleSession();
  state.token = null;
  state.user = null;
  state.conversations = [];
  state.activeConversationId = null;
  state.onlineUsers.clear();
  sessionStorage.removeItem("orbit-chat-token");
  messageList.replaceChildren();
  showAuth();
}

async function clearGoogleSession() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut({ scope: "local" });
  if (error) showToast("Could not clear the Google sign-in session.");
}

function updateProfile() {
  const initials = getInitials(state.user.name) || "?";
  document.querySelector("#profile-name").textContent = state.user.name;
  document.querySelector("#profile-email").textContent = state.user.email;
  document.querySelector("#profile-avatar").textContent = initials;
}

function visibleConversations() {
  const query = state.search.trim().toLowerCase();
  let visible = state.conversations.filter((conversation) => {
    const matchesText =
      !query ||
      conversation.name.toLowerCase().includes(query) ||
      conversation.preview.toLowerCase().includes(query);
    const matchesFilter = state.activeFilter === "all" || conversation.isGroup;
    return matchesText && matchesFilter;
  });
  if (!state.newestFirst) visible = [...visible].reverse();
  return visible;
}

function createAvatar(initials, color, extraClass = "") {
  const avatar = document.createElement("span");
  avatar.className = `avatar ${color} ${extraClass}`.trim();
  avatar.textContent = initials;
  return avatar;
}

function renderConversations() {
  conversationList.replaceChildren();
  const visible = visibleConversations();
  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent =
      state.conversations.length === 0
        ? "No chats yet. Start a direct message or create a group."
        : "No conversations match your search.";
    conversationList.append(empty);
    return;
  }

  for (const conversation of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${conversation.id === state.activeConversationId ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", String(conversation.id === state.activeConversationId));

    const avatar = createAvatar(conversation.initials, conversation.color, "conversation-avatar");
    const copy = document.createElement("span");
    copy.className = "conversation-copy";

    const topLine = document.createElement("span");
    topLine.className = "conversation-topline";
    const name = document.createElement("strong");
    name.textContent = conversation.name;
    const time = document.createElement("span");
    time.className = "conversation-time";
    time.textContent = conversation.lastAt ? formatTime(conversation.lastAt) : "";
    topLine.append(name, time);

    const bottomLine = document.createElement("span");
    bottomLine.className = "conversation-bottomline";
    const preview = document.createElement("span");
    preview.className = "conversation-preview";
    preview.textContent = conversation.preview || "No messages yet";
    bottomLine.append(preview);

    copy.append(topLine, bottomLine);
    button.append(avatar, copy);
    button.addEventListener("click", () => selectConversation(conversation.id));
    conversationList.append(button);
  }
}

function setPresence(userId, online) {
  if (online) state.onlineUsers.add(userId);
  else state.onlineUsers.delete(userId);

  for (const conversation of state.conversations) {
    if (conversation.otherUserId === userId) {
      conversation.presence = online ? "Online" : "Offline";
    }
  }
  if (getActiveConversation()?.otherUserId === userId) {
    updateConversationDetails(getActiveConversation());
  }
  renderConversations();
}

function updateConversationDetails(conversation) {
  const direct = !conversation.isGroup;
  document.querySelector("#header-name").textContent = conversation.name;
  document.querySelector("#header-presence").replaceChildren();
  if (conversation.presence === "Online") {
    const dot = document.createElement("span");
    dot.className = "presence-dot";
    document.querySelector("#header-presence").append(dot);
  }
  document.querySelector("#header-presence").append(document.createTextNode(conversation.presence));

  const initials = getInitials(conversation.name);
  const avatarColor = conversation.color;
  for (const [selector, extraClass] of [
    ["#header-avatar", "header-avatar"],
    ["#details-avatar", "contact-avatar"],
  ]) {
    const avatar = document.querySelector(selector);
    avatar.className = `avatar ${extraClass} ${avatarColor}`;
    avatar.textContent = initials;
  }

  document.querySelector("#details-name").textContent = conversation.name;
  document.querySelector("#details-role").textContent = direct ? "Safe Chat member" : "Group conversation";
  document.querySelector("#details-presence").textContent = conversation.presence;
  document.querySelector("#details-status-dot").hidden = !direct || conversation.presence !== "Online";
  document.querySelector("#details-about").textContent = direct
    ? "A private conversation between you and this member."
    : "A shared space for messages between group members.";
  document.querySelector("#details-description").textContent = conversation.isGroup
    ? `Group chat · ${conversation.memberCount} members`
    : "Private one-to-one conversation";
  document.querySelector("#details-members").textContent = direct
    ? `You and ${conversation.name}`
    : `${conversation.memberCount} members`;

  document.querySelector("#voice-call-button").disabled = !direct;
  document.querySelector("#video-call-button").disabled = !direct;
  document.querySelector("#details-voice-call-button").disabled = !direct;
  document.querySelector("#details-video-call-button").disabled = !direct;
  document.querySelector("#details-message-button").disabled = false;
  document.querySelector("#details-toggle").disabled = false;
}

function getActiveConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) || null;
}

function renderMessage(message) {
  const conversation = state.conversations.find(
    (item) => item.id === message.conversationId,
  );
  const isOwnMessage = message.senderId === state.user.id;

  const row = document.createElement("article");
  row.className = `message-row${isOwnMessage ? " is-sent" : ""}`;

  if (!isOwnMessage) {
    row.append(
      createAvatar(
        getInitials(message.senderName || "Member"),
        conversation?.color || "avatar-blue",
        "message-avatar",
      ),
    );
  }

  const stack = document.createElement("div");
  stack.className = "message-stack";
  if (!isOwnMessage && conversation?.isGroup) {
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.senderName;
    stack.append(author);
  }

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  const text = document.createElement("p");
  text.className = "message-text";
  text.textContent = message.text;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const time = document.createElement("time");
  time.dateTime = message.createdAt;
  time.textContent = formatTime(message.createdAt);
  meta.append(time);
  if (isOwnMessage) {
    const check = document.createElement("span");
    check.className = "message-check";
    check.setAttribute("aria-label", "Sent");
    check.textContent = "✓✓";
    meta.append(check);
  }

  bubble.append(text, meta);
  stack.append(bubble);
  row.append(stack);
  messageList.append(row);
}

function showSelectedConversation(conversation) {
  state.activeConversationId = conversation.id;
  messageList.replaceChildren();
  document.querySelector("#message-date").hidden = false;
  document.querySelector("#welcome-empty").hidden = true;
  composerWrap.hidden = false;
  updateConversationDetails(conversation);
  renderConversations();
  appShell.classList.add("chat-open");

  if (!socket.connected) {
    updateConnectionStatus(false);
    return;
  }

  socket.emit("join_chat", conversation.id, (result) => {
    if (state.activeConversationId !== conversation.id) return;
    if (!result?.ok) {
      showToast(result?.error || "Could not open this conversation.");
      return;
    }
    messageList.replaceChildren();
    result.messages.forEach(renderMessage);
    const latest = result.messages[result.messages.length - 1];
    if (latest) {
      conversation.preview = latest.text;
      conversation.lastAt = latest.createdAt;
      renderConversations();
    }
    window.requestAnimationFrame(() => {
      messageArea.scrollTop = messageArea.scrollHeight;
    });
  });
}

function selectConversation(conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (conversation) showSelectedConversation(conversation);
}

function handleIncomingMessage(message) {
  const conversation = state.conversations.find((item) => item.id === message.conversationId);
  if (!conversation) return;
  conversation.preview = message.text;
  conversation.lastAt = message.createdAt;
  if (message.conversationId === state.activeConversationId) {
    renderMessage(message);
    messageArea.scrollTop = messageArea.scrollHeight;
  }
  renderConversations();
}

async function loadConversations(preferredId = state.activeConversationId) {
  const result = await api("/api/conversations");
  state.conversations = result.conversations.map((conversation) => ({
    ...conversation,
    initials: getInitials(conversation.name),
    color: getAvatarColor(conversation.id, conversation.isGroup),
    unread: 0,
  }));
  for (const conversation of state.conversations) {
    if (conversation.otherUserId && state.onlineUsers.has(conversation.otherUserId)) {
      conversation.presence = "Online";
    }
  }

  renderConversations();
  const nextActive = state.conversations.find((item) => item.id === preferredId) || state.conversations[0];
  if (nextActive) showSelectedConversation(nextActive);
  else {
    state.activeConversationId = null;
    document.querySelector("#header-name").textContent = "Choose a conversation";
    document.querySelector("#header-presence").textContent = "";
    document.querySelector("#header-avatar").className = "avatar header-avatar";
    document.querySelector("#header-avatar").textContent = "";
    document.querySelector("#message-date").hidden = true;
    document.querySelector("#welcome-empty").hidden = false;
    composerWrap.hidden = true;
    document.querySelector("#voice-call-button").disabled = true;
    document.querySelector("#video-call-button").disabled = true;
    document.querySelector("#details-voice-call-button").disabled = true;
    document.querySelector("#details-video-call-button").disabled = true;
    document.querySelector("#details-message-button").disabled = true;
    document.querySelector("#details-toggle").disabled = true;
  }
}

function showUserSearchMessage(container, message) {
  container.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-list";
  empty.textContent = message;
  container.append(empty);
}

function renderUserResults(container, users, onSelect, selectable = false) {
  container.replaceChildren();
  if (users.length === 0) {
    showUserSearchMessage(container, "No matching accounts found.");
    return;
  }

  for (const user of users) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `user-result${selectable && state.selectedGroupUsers.has(user.id) ? " is-selected" : ""}`;
    const avatar = createAvatar(getInitials(user.name), getAvatarColor(user.id), "user-result-avatar");
    const copy = document.createElement("span");
    copy.className = "user-result-copy";
    const name = document.createElement("strong");
    name.textContent = user.name;
    const email = document.createElement("span");
    email.textContent = user.email;
    const presence = document.createElement("span");
    presence.className = `user-result-presence${user.online ? " is-online" : ""}`;
    presence.textContent = user.online ? "Online" : "Offline";
    copy.append(name, email);
    button.append(avatar, copy, presence);
    button.addEventListener("click", () => onSelect(user));
    container.append(button);
  }
}

async function searchUsers(input, container, selectable = false) {
  const query = input.value.trim();
  const requestId = ++userSearchSequence;
  if (query.length < 2) {
    showUserSearchMessage(container, "Type at least 2 characters to search.");
    return;
  }
  showUserSearchMessage(container, "Searching…");
  try {
    const result = await api(`/api/users?search=${encodeURIComponent(query)}`);
    if (requestId !== userSearchSequence) return;
    const handleSelect = (user) => {
      if (!selectable) {
        openDirectConversation(user.id);
        return;
      }
      if (state.selectedGroupUsers.has(user.id)) state.selectedGroupUsers.delete(user.id);
      else state.selectedGroupUsers.add(user.id);
      renderUserResults(container, result.users, handleSelect, true);
      updateGroupForm();
    };
    renderUserResults(container, result.users, handleSelect, selectable);
  } catch (error) {
    if (requestId === userSearchSequence) showUserSearchMessage(container, error.message);
  }
}

function openConversationDialog() {
  conversationError.textContent = "";
  state.selectedGroupUsers.clear();
  document.querySelector("#user-search").value = "";
  document.querySelector("#group-user-search").value = "";
  document.querySelector("#group-title").value = "";
  updateGroupForm();
  showUserSearchMessage(userResults, "Type at least 2 characters to search.");
  showUserSearchMessage(groupUserResults, "Type at least 2 characters to search.");
  setConversationMode("direct");
  conversationDialog.showModal();
  document.querySelector("#user-search").focus();
}

function setConversationMode(mode) {
  const isGroup = mode === "group";
  document.querySelector("#direct-pane").hidden = isGroup;
  document.querySelector("#group-pane").hidden = !isGroup;
  document.querySelector("#direct-tab").classList.toggle("is-active", !isGroup);
  document.querySelector("#group-tab").classList.toggle("is-active", isGroup);
  document.querySelector("#direct-tab").setAttribute("aria-selected", String(!isGroup));
  document.querySelector("#group-tab").setAttribute("aria-selected", String(isGroup));
  conversationError.textContent = "";
  if (isGroup) document.querySelector("#group-title").focus();
  else document.querySelector("#user-search").focus();
}

async function openDirectConversation(userId) {
  try {
    const result = await api("/api/conversations/direct", {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
    conversationDialog.close();
    await loadConversations(result.conversationId);
  } catch (error) {
    conversationError.textContent = error.message;
  }
}

function updateGroupForm() {
  const count = state.selectedGroupUsers.size;
  document.querySelector("#selected-count").textContent =
    count === 0 ? "Choose at least one person." : `${count} ${count === 1 ? "person" : "people"} selected`;
  document.querySelector("#create-group-button").disabled =
    count === 0 || document.querySelector("#group-title").value.trim().length < 2;
}

async function createGroup(event) {
  event.preventDefault();
  const title = document.querySelector("#group-title").value.trim();
  const userIds = [...state.selectedGroupUsers];
  try {
    const result = await api("/api/conversations/group", {
      method: "POST",
      body: JSON.stringify({ title, userIds }),
    });
    conversationDialog.close();
    await loadConversations(result.conversationId);
  } catch (error) {
    conversationError.textContent = error.message;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const conversation = getActiveConversation();
  const text = messageInput.value.trim();
  if (!conversation || !text) {
    messageInput.focus();
    return;
  }
  if (!socket.connected) {
    showToast("You are offline. Your message was not sent.");
    return;
  }

  socket.emit(
    "send_message",
    { conversationId: conversation.id, text },
    (result) => {
      if (!result?.ok) {
        showToast(result?.error || "The message could not be sent.");
        return;
      }
      messageInput.value = "";
      messageInput.focus();
    },
  );
}

function updateAuthFromServer(result) {
  saveAuth(result);
  authScreen.hidden = true;
  appShell.hidden = false;
  updateProfile();
  callController = window.createCallController({
    socket,
    api,
    getActiveConversation,
    showToast,
  });
  socket.auth = { token: state.token };
  socket.connect();
  loadConversations().catch((error) => showToast(error.message));
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  const name = document.querySelector("#auth-name").value.trim();
  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  if (!email || !password || (state.authMode === "register" && name.length < 2)) {
    authError.textContent = "Fill in all required fields.";
    return;
  }

  const submit = document.querySelector("#auth-submit");
  submit.disabled = true;
  try {
    const route = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const result = await api(route, {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
    updateAuthFromServer(result);
  } catch (error) {
    authError.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#google-sign-in").addEventListener("click", async (event) => {
  authError.textContent = "";
  if (!supabaseClient) {
    authError.textContent =
      "Google sign-in is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment.";
    return;
  }

  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  } catch (error) {
    authError.textContent = error.message || "Google sign-in could not be started.";
    button.disabled = false;
  }
});

document.querySelector("#auth-toggle").addEventListener("click", () => {
  setAuthMode(state.authMode === "login" ? "register" : "login");
});
document.querySelector("#sign-out").addEventListener("click", signOut);
document.querySelector("#new-chat-button").addEventListener("click", openConversationDialog);
document.querySelector("#empty-new-chat").addEventListener("click", openConversationDialog);
document.querySelector("#close-conversation-dialog").addEventListener("click", () => conversationDialog.close());
document.querySelector("#direct-tab").addEventListener("click", () => setConversationMode("direct"));
document.querySelector("#group-tab").addEventListener("click", () => setConversationMode("group"));
document.querySelector("#group-form").addEventListener("submit", createGroup);
document.querySelector("#group-title").addEventListener("input", updateGroupForm);
document.querySelector("#user-search").addEventListener("input", (event) =>
  searchUsers(event.currentTarget, userResults),
);
document.querySelector("#group-user-search").addEventListener("input", (event) =>
  searchUsers(event.currentTarget, groupUserResults, true),
);

chatSearch.addEventListener("input", () => {
  state.search = chatSearch.value;
  renderConversations();
});
document.querySelectorAll(".filter-tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab === button);
    });
    renderConversations();
  });
});
document.querySelector("#sort-button").addEventListener("click", (event) => {
  state.newestFirst = !state.newestFirst;
  event.currentTarget.textContent = state.newestFirst ? "Newest" : "Oldest";
  renderConversations();
});
document.querySelector("#nav-chats").addEventListener("click", () => appShell.classList.remove("chat-open"));
document.querySelector("#back-to-list").addEventListener("click", () => appShell.classList.remove("chat-open"));
document.querySelector("#details-voice-call-button").addEventListener("click", () => {
  document.querySelector("#voice-call-button").click();
});
document.querySelector("#details-video-call-button").addEventListener("click", () => {
  document.querySelector("#video-call-button").click();
});
document.querySelector("#details-message-button").addEventListener("click", () => messageInput.focus());
document.querySelector("#details-toggle").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 930px)").matches) {
    showToast("Conversation details are hidden on smaller screens.");
    return;
  }
  appShell.classList.toggle("details-collapsed");
});
document.querySelector("#emoji-button").addEventListener("click", () => {
  const start = messageInput.selectionStart;
  const end = messageInput.selectionEnd;
  messageInput.setRangeText("🙂", start, end, "end");
  messageInput.focus();
});
messageForm.addEventListener("submit", sendMessage);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    chatSearch.focus();
  }
});

socket.on("connect", () => {
  updateConnectionStatus(true);
  const conversation = getActiveConversation();
  if (conversation) showSelectedConversation(conversation);
});
socket.on("disconnect", () => {
  updateConnectionStatus(false);
  callController?.handleDisconnect();
});
socket.on("connect_error", (error) => {
  updateConnectionStatus(false);
  if (/sign in|session|account/i.test(error.message)) {
    showToast("Your session expired. Please sign in again.");
    signOut();
  }
});
socket.on("presence:snapshot", (userIds) => {
  state.onlineUsers = new Set(userIds);
  for (const conversation of state.conversations) {
    if (conversation.otherUserId) {
      conversation.presence = state.onlineUsers.has(conversation.otherUserId) ? "Online" : "Offline";
    }
  }
  renderConversations();
  if (getActiveConversation()) updateConversationDetails(getActiveConversation());
});
socket.on("presence:update", ({ userId, online }) => setPresence(userId, online));
socket.on("receive_message", handleIncomingMessage);
socket.on("chat_error", (message) => showToast(String(message)));

socket.on("call:incoming", (call) => callController?.handleIncoming(call));
socket.on("call:accepted", (event) => callController?.handleAccepted(event));
socket.on("call:signal", (event) => callController?.handleSignal(event));
socket.on("call:ended", (event) => callController?.handleEnded(event));

async function restoreSession() {
  if (!state.token) {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.auth.getSession();
      if (error) {
        showAuth();
        authError.textContent = "Could not restore the Google sign-in session. Please try again.";
        return;
      }
      if (data.session) {
        try {
          const result = await api("/api/auth/google", {
            method: "POST",
            body: JSON.stringify({ accessToken: data.session.access_token }),
          });
          await clearGoogleSession();
          updateAuthFromServer(result);
        } catch (exchangeError) {
          await clearGoogleSession();
          showAuth();
          authError.textContent = exchangeError.message;
        }
        return;
      }
    }
    showAuth();
    return;
  }
  try {
    const result = await api("/api/me");
    state.user = result.user;
    authScreen.hidden = true;
    appShell.hidden = false;
    updateProfile();
    callController = window.createCallController({
      socket,
      api,
      getActiveConversation,
      showToast,
    });
    socket.auth = { token: state.token };
    socket.connect();
    await loadConversations();
  } catch (error) {
    sessionStorage.removeItem("orbit-chat-token");
    state.token = null;
    showAuth();
    authError.textContent = error.message;
  }
}

restoreSession();
