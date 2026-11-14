const socket = io();

const conversations = [
  {
    id: "sarah",
    name: "Sarah Connor",
    initials: "SC",
    color: "avatar-rose",
    type: "direct",
    presence: "Online",
    role: "Product designer",
    preview: "Could you check the mobile spacing too?",
    unread: 1,
    about: "Designing a calmer, more useful way for teams to work together.",
    description: "A private conversation with Sarah about product design and the next release.",
    members: "Just you and Sarah",
  },
  {
    id: "design-team",
    name: "Design Team",
    initials: "DT",
    color: "avatar-teal avatar-group",
    type: "group",
    presence: "8 members",
    role: "Project group",
    preview: "Maya: The new concepts are ready to review",
    unread: 3,
    about: "A shared space for sketches, feedback, and design decisions.",
    description: "The team workspace for reviewing concepts and sharing product updates.",
    members: "You, Maya, Sarah, Jonah, and 4 others",
  },
  {
    id: "katia",
    name: "Katia Mavin",
    initials: "KM",
    color: "avatar-violet",
    type: "direct",
    presence: "Last seen 10 minutes ago",
    role: "Frontend developer",
    preview: "The new chat layout is looking great!",
    unread: 0,
    about: "Frontend developer who loves thoughtful details and tidy interfaces.",
    description: "A private conversation with Katia.",
    members: "Just you and Katia",
  },
  {
    id: "rona",
    name: "Rona Klein",
    initials: "RK",
    color: "avatar-gold",
    type: "direct",
    presence: "Online",
    role: "Researcher",
    preview: "I added the interview notes to the folder.",
    unread: 0,
    about: "Turning user feedback into better product experiences.",
    description: "A private conversation with Rona.",
    members: "Just you and Rona",
  },
  {
    id: "leo",
    name: "Leo Park",
    initials: "LP",
    color: "avatar-blue",
    type: "direct",
    presence: "Away",
    role: "Engineer",
    preview: "Can we sync on the API tomorrow?",
    unread: 0,
    about: "Building reliable tools for creative teams.",
    description: "A private conversation with Leo.",
    members: "Just you and Leo",
  },
];

const appShell = document.querySelector("#app-shell");
const conversationList = document.querySelector("#conversation-list");
const chatSearch = document.querySelector("#chat-search");
const messageArea = document.querySelector("#message-area");
const messageList = document.querySelector("#message-list");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const connectionStatus = document.querySelector("#connection-status");
const profileDialog = document.querySelector("#profile-dialog");
const profileForm = document.querySelector("#profile-form");
const displayNameInput = document.querySelector("#display-name-input");
const toast = document.querySelector("#toast");

let activeConversationId = "sarah";
let activeFilter = "all";
let sortNewestFirst = true;
let toastTimeout;

function getOrCreateUserId() {
  let userId = localStorage.getItem("orbit-chat-user-id");
  if (!userId) {
    userId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("orbit-chat-user-id", userId);
  }
  return userId;
}

const currentUserId = getOrCreateUserId();
let currentUserName = localStorage.getItem("orbit-chat-display-name") || "Alex Morgan";

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2600);
}

function formatTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getActiveConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId);
}

function createAvatar(initials, color, extraClass = "") {
  const avatar = document.createElement("span");
  avatar.className = `avatar ${color} ${extraClass}`.trim();
  avatar.textContent = initials;
  return avatar;
}

function getVisibleConversations() {
  const query = chatSearch.value.trim().toLowerCase();
  let visible = conversations.filter((conversation) => {
    const matchesQuery =
      !query ||
      conversation.name.toLowerCase().includes(query) ||
      conversation.preview.toLowerCase().includes(query);
    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "unread" && conversation.unread > 0) ||
      (activeFilter === "groups" && conversation.type === "group");
    return matchesQuery && matchesFilter;
  });

  if (!sortNewestFirst) visible = [...visible].reverse();
  return visible;
}

function renderConversations() {
  conversationList.replaceChildren();
  const visible = getVisibleConversations();

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No conversations match. Try another search or filter.";
    conversationList.append(empty);
    return;
  }

  visible.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${conversation.id === activeConversationId ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", String(conversation.id === activeConversationId));

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
    preview.textContent = conversation.preview;
    bottomLine.append(preview);

    if (conversation.unread > 0) {
      const unread = document.createElement("span");
      unread.className = "unread-count";
      unread.textContent = String(conversation.unread);
      unread.setAttribute("aria-label", `${conversation.unread} unread messages`);
      bottomLine.append(unread);
    }

    copy.append(topLine, bottomLine);
    button.append(avatar, copy);
    button.addEventListener("click", () => selectConversation(conversation.id));
    conversationList.append(button);
  });
}

function updateProfile() {
  const initials = getInitials(currentUserName) || "AM";
  document.querySelector("#profile-name").textContent = currentUserName;
  document.querySelector("#profile-avatar").textContent = initials;
  document.querySelector("#rail-profile").textContent = initials;
}

function updateConversationDetails(conversation) {
  document.querySelector("#header-name").textContent = conversation.name;
  document.querySelector("#header-presence").replaceChildren();
  const isOnline = conversation.presence === "Online";
  if (isOnline) {
    const dot = document.createElement("span");
    dot.className = "presence-dot";
    document.querySelector("#header-presence").append(dot);
  }
  document.querySelector("#header-presence").append(document.createTextNode(conversation.presence));

  const headerAvatar = document.querySelector("#header-avatar");
  headerAvatar.className = `avatar header-avatar ${conversation.color}`;
  headerAvatar.textContent = conversation.initials;

  const detailsAvatar = document.querySelector("#details-avatar");
  detailsAvatar.className = `avatar contact-avatar ${conversation.color}`;
  detailsAvatar.textContent = conversation.initials;
  document.querySelector("#details-name").textContent = conversation.name;
  document.querySelector("#details-role").textContent = conversation.role;
  document.querySelector("#details-presence").textContent = conversation.presence;
  document.querySelector("#details-about").textContent = conversation.about;
  document.querySelector("#details-description").textContent = conversation.description;
  document.querySelector("#details-members").textContent = conversation.members;
}

function renderMessage(message) {
  const conversation = conversations.find((item) => item.id === message.chatId);
  const isOwnMessage =
    message.senderId === currentUserId || message.senderId === "demo-user";

  const row = document.createElement("article");
  row.className = `message-row${isOwnMessage ? " is-sent" : ""}`;

  if (!isOwnMessage) {
    row.append(
      createAvatar(
        getInitials(message.senderName || conversation?.name || "Guest"),
        conversation?.color || "avatar-blue",
        "message-avatar",
      ),
    );
  }

  const stack = document.createElement("div");
  stack.className = "message-stack";

  if (!isOwnMessage && conversation?.type === "group") {
    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = message.senderName || "Guest";
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

function selectConversation(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) return;

  activeConversationId = conversationId;
  conversation.unread = 0;
  messageList.replaceChildren();
  updateConversationDetails(conversation);
  renderConversations();
  appShell.classList.add("chat-open");
  socket.emit("join_chat", conversationId);
}

function updateConnectionStatus(connected) {
  connectionStatus.classList.toggle("is-offline", !connected);
  connectionStatus.lastChild.textContent = connected ? " Connected" : " Reconnecting...";
}

function appendMessage(message) {
  if (!message || message.chatId !== activeConversationId) return;
  renderMessage(message);
  messageArea.scrollTop = messageArea.scrollHeight;

  const conversation = conversations.find((item) => item.id === message.chatId);
  if (conversation) {
    conversation.preview = message.text;
    conversation.lastAt = message.createdAt;
    renderConversations();
  }
}

document.querySelectorAll(".filter-tab").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll(".filter-tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab === button);
    });
    renderConversations();
  });
});

chatSearch.addEventListener("input", renderConversations);
document.querySelector("#new-chat-button").addEventListener("click", () => {
  chatSearch.focus();
  showToast("Search for a conversation by name.");
});
document.querySelector("#sort-button").addEventListener("click", (event) => {
  sortNewestFirst = !sortNewestFirst;
  event.currentTarget.textContent = sortNewestFirst ? "Newest" : "Oldest";
  renderConversations();
});

document.querySelectorAll("[data-coming-soon]").forEach((button) => {
  button.addEventListener("click", () => showToast(button.dataset.comingSoon));
});

document.querySelector("#details-toggle").addEventListener("click", () => {
  if (window.matchMedia("(max-width: 930px)").matches) {
    showToast("Conversation details are available on wider screens.");
    return;
  }
  appShell.classList.toggle("details-collapsed");
});
document.querySelector("#back-to-list").addEventListener("click", () => {
  appShell.classList.remove("chat-open");
});

document.querySelector("#emoji-button").addEventListener("click", () => {
  const start = messageInput.selectionStart;
  const end = messageInput.selectionEnd;
  messageInput.setRangeText("🙂", start, end, "end");
  messageInput.focus();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) {
    messageInput.focus();
    return;
  }
  if (!socket.connected) {
    showToast("You are offline. Your message was not sent.");
    return;
  }

  socket.emit("send_message", {
    chatId: activeConversationId,
    text,
    senderId: currentUserId,
    senderName: currentUserName,
  });
  messageInput.value = "";
  messageInput.focus();
});

document.querySelector("#open-profile").addEventListener("click", () => {
  displayNameInput.value = currentUserName;
  profileDialog.showModal();
  displayNameInput.focus();
});
document.querySelector("#rail-profile").addEventListener("click", () => {
  displayNameInput.value = currentUserName;
  profileDialog.showModal();
  displayNameInput.focus();
});

function closeProfileDialog() {
  profileDialog.close();
}

document.querySelector("#close-profile").addEventListener("click", closeProfileDialog);
document.querySelector("#cancel-profile").addEventListener("click", closeProfileDialog);
profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextName = displayNameInput.value.trim().slice(0, 24);
  if (!nextName) {
    displayNameInput.focus();
    return;
  }
  currentUserName = nextName;
  localStorage.setItem("orbit-chat-display-name", currentUserName);
  updateProfile();
  closeProfileDialog();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    chatSearch.focus();
  }
});

socket.on("connect", () => {
  updateConnectionStatus(true);
  socket.emit("join_chat", activeConversationId);
});
socket.on("disconnect", () => updateConnectionStatus(false));
socket.on("connect_error", () => updateConnectionStatus(false));
socket.on("chat_history", (payload) => {
  if (!payload || payload.chatId !== activeConversationId || !Array.isArray(payload.messages)) return;
  messageList.replaceChildren();
  payload.messages.forEach(renderMessage);
  const conversation = getActiveConversation();
  const latest = payload.messages[payload.messages.length - 1];
  if (conversation && latest) {
    conversation.preview = latest.text;
    conversation.lastAt = latest.createdAt;
    renderConversations();
  }
  window.requestAnimationFrame(() => {
    messageArea.scrollTop = messageArea.scrollHeight;
  });
});
socket.on("receive_message", appendMessage);
socket.on("chat_error", (message) => showToast(String(message)));

updateProfile();
updateConversationDetails(getActiveConversation());
renderConversations();
