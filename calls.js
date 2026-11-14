window.createCallController = function createCallController({
  socket,
  api,
  getActiveConversation,
  showToast,
}) {
  const incomingDialog = document.querySelector("#incoming-call-dialog");
  const callOverlay = document.querySelector("#call-overlay");
  const remoteVideo = document.querySelector("#remote-video");
  const localVideo = document.querySelector("#local-video");
  const remotePlaceholder = document.querySelector("#remote-placeholder");
  const muteButton = document.querySelector("#mute-call");
  const cameraButton = document.querySelector("#toggle-camera");

  let incomingCall = null;
  let currentCall = null;
  let peerConnection = null;
  let localStream = null;
  let remoteStream = null;
  let pendingCandidates = [];

  function setCallStatus(message) {
    document.querySelector("#call-status").textContent = message;
  }

  function showCallWindow(call) {
    document.querySelector("#call-kind").textContent = call.video ? "VIDEO CALL" : "VOICE CALL";
    document.querySelector("#call-person-name").textContent = call.remoteName;
    document.querySelector("#call-avatar").textContent = call.initials;
    document.querySelector("#call-avatar").className = `avatar call-avatar ${call.color}`;
    document.querySelector("#remote-audio-label").textContent = "Waiting for the other person…";
    remoteVideo.hidden = true;
    localVideo.hidden = !call.video;
    cameraButton.hidden = !call.video;
    remotePlaceholder.hidden = false;
    callOverlay.hidden = false;
  }

  function closeCallWindow() {
    callOverlay.hidden = true;
    incomingDialog.close();
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    remoteVideo.hidden = true;
    localVideo.hidden = true;
    cameraButton.hidden = true;
    muteButton.classList.remove("is-muted");
    cameraButton.classList.remove("is-muted");
  }

  function closePeerConnection() {
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.close();
      peerConnection = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    remoteStream = null;
    pendingCandidates = [];
    closeCallWindow();
  }

  function finishLocally(reason) {
    currentCall = null;
    incomingCall = null;
    closePeerConnection();
    if (reason === "missed") showToast("The call was missed.");
    else if (reason === "declined") showToast("The call was declined.");
    else if (reason === "disconnected") showToast("The other person disconnected.");
  }

  function sendSignal(data) {
    if (!currentCall?.callId) return;
    socket.emit("call:signal", { callId: currentCall.callId, data }, (result) => {
      if (!result?.ok) showToast(result?.error || "Could not send call data.");
    });
  }

  async function addPendingCandidates() {
    const candidates = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of candidates) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  async function preparePeerConnection(call) {
    const config = await api("/api/rtc-config");
    peerConnection = new RTCPeerConnection({ iceServers: config.iceServers });
    for (const track of localStream.getTracks()) {
      peerConnection.addTrack(track, localStream);
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) sendSignal({ candidate: event.candidate.toJSON() });
    };
    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0] || new MediaStream();
      if (event.streams.length === 0) remoteStream.addTrack(event.track);
      remoteVideo.srcObject = remoteStream;
      if (event.track.kind === "video") {
        remoteVideo.hidden = false;
        remotePlaceholder.hidden = true;
      } else {
        document.querySelector("#remote-audio-label").textContent = "Audio connected";
      }
    };
    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      if (peerConnection.connectionState === "connected") {
        setCallStatus(call.video ? "Video connected" : "Call connected");
      } else if (peerConnection.connectionState === "disconnected") {
        setCallStatus("Connection interrupted…");
      } else if (peerConnection.connectionState === "failed") {
        setCallStatus("Connection failed");
        showToast("Call connection failed. Check your network or TURN configuration.");
        endCurrentCall();
      }
    };
  }

  async function requestLocalMedia(video) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone or camera access.");
    }
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
  }

  async function startCall(video) {
    const conversation = getActiveConversation();
    if (!conversation || conversation.isGroup || !conversation.otherUserId) {
      showToast("Calls are available in one-to-one conversations only.");
      return;
    }
    if (!socket.connected) {
      showToast("Reconnect to chat before starting a call.");
      return;
    }
    if (conversation.presence !== "Online") {
      showToast("This person is offline right now.");
      return;
    }
    if (currentCall || incomingCall) {
      showToast("Finish your current call before starting another.");
      return;
    }

    currentCall = {
      conversationId: conversation.id,
      remoteUserId: conversation.otherUserId,
      remoteName: conversation.name,
      initials: conversation.initials,
      color: conversation.color,
      video,
      role: "caller",
      callId: null,
    };

    try {
      localStream = await requestLocalMedia(video);
      localVideo.srcObject = localStream;
      showCallWindow(currentCall);
      setCallStatus("Calling…");
      await preparePeerConnection(currentCall);
      socket.emit(
        "call:invite",
        { conversationId: conversation.id, video },
        (result) => {
          if (!result?.ok) {
            showToast(result?.error || "The call could not be started.");
            finishLocally("failed");
            return;
          }
          if (!currentCall) return;
          currentCall.callId = result.callId;
        },
      );
    } catch (error) {
      finishLocally("failed");
      showToast(error.message || "Could not access your microphone or camera.");
    }
  }

  function handleIncoming(call) {
    if (currentCall || incomingCall) {
      socket.emit("call:reject", call.callId, () => {});
      return;
    }
    incomingCall = call;
    document.querySelector("#incoming-name").textContent = call.caller.name;
    document.querySelector("#incoming-description").textContent = call.video
      ? "Incoming video call"
      : "Incoming voice call";
    document.querySelector("#incoming-kind").textContent = call.video
      ? "INCOMING VIDEO CALL"
      : "INCOMING VOICE CALL";
    const avatar = document.querySelector("#incoming-avatar");
    avatar.textContent = call.caller.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();
    incomingDialog.showModal();
  }

  async function acceptCall() {
    if (!incomingCall || currentCall) return;
    const incoming = incomingCall;
    incomingCall = null;
    incomingDialog.close();

    currentCall = {
      callId: incoming.callId,
      conversationId: incoming.conversationId,
      remoteUserId: incoming.caller.id,
      remoteName: incoming.caller.name,
      initials: document.querySelector("#incoming-avatar").textContent,
      color: "avatar-teal",
      video: incoming.video,
      role: "callee",
    };

    try {
      localStream = await requestLocalMedia(currentCall.video);
      localVideo.srcObject = localStream;
      showCallWindow(currentCall);
      setCallStatus("Connecting…");
      await preparePeerConnection(currentCall);
      socket.emit("call:accept", currentCall.callId, (result) => {
        if (!result?.ok) {
          showToast(result?.error || "Could not accept this call.");
          endCurrentCall();
        }
      });
    } catch (error) {
      socket.emit("call:reject", incoming.callId, () => {});
      finishLocally("failed");
      showToast(error.message || "Could not access your microphone or camera.");
    }
  }

  function rejectCall() {
    if (!incomingCall) return;
    socket.emit("call:reject", incomingCall.callId, () => {});
    incomingCall = null;
    incomingDialog.close();
  }

  async function handleAccepted(event) {
    if (!currentCall || currentCall.callId !== event.callId || currentCall.role !== "caller") return;
    try {
      setCallStatus("Connecting…");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      sendSignal({ description: peerConnection.localDescription.toJSON() });
    } catch (error) {
      showToast(error.message || "Could not create the call connection.");
      endCurrentCall();
    }
  }

  async function handleSignal(event) {
    if (!currentCall || currentCall.callId !== event.callId || !peerConnection) return;
    try {
      if (event.data.description) {
        const description = new RTCSessionDescription(event.data.description);
        await peerConnection.setRemoteDescription(description);
        await addPendingCandidates();
        if (description.type === "offer" && currentCall.role === "callee") {
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          sendSignal({ description: peerConnection.localDescription.toJSON() });
        }
      } else if (event.data.candidate) {
        if (peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(event.data.candidate));
        } else {
          pendingCandidates.push(event.data.candidate);
        }
      }
    } catch (error) {
      showToast(error.message || "Call setup failed.");
      endCurrentCall();
    }
  }

  function handleEnded(event) {
    if (currentCall?.callId === event.callId) {
      finishLocally(event.reason);
      return;
    }
    if (incomingCall?.callId === event.callId) {
      incomingCall = null;
      incomingDialog.close();
      if (event.reason === "missed") showToast("The call was missed.");
    }
  }

  function endCurrentCall(reason = "ended") {
    if (currentCall?.callId && socket.connected) {
      socket.emit("call:end", currentCall.callId, () => {});
    }
    if (incomingCall?.callId && socket.connected) {
      socket.emit("call:reject", incomingCall.callId, () => {});
    }
    finishLocally(reason);
  }

  function handleDisconnect() {
    if (currentCall) finishLocally("disconnected");
    if (incomingCall) {
      incomingCall = null;
      incomingDialog.close();
    }
  }

  muteButton.addEventListener("click", () => {
    const track = localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    muteButton.classList.toggle("is-muted", !track.enabled);
    muteButton.setAttribute("aria-label", track.enabled ? "Mute microphone" : "Unmute microphone");
    muteButton.title = track.enabled ? "Mute microphone" : "Unmute microphone";
  });

  cameraButton.addEventListener("click", () => {
    const track = localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    cameraButton.classList.toggle("is-muted", !track.enabled);
    cameraButton.setAttribute("aria-label", track.enabled ? "Turn camera off" : "Turn camera on");
    cameraButton.title = track.enabled ? "Turn camera off" : "Turn camera on";
  });

  document.querySelector("#voice-call-button").addEventListener("click", () => startCall(false));
  document.querySelector("#video-call-button").addEventListener("click", () => startCall(true));
  document.querySelector("#accept-call").addEventListener("click", acceptCall);
  document.querySelector("#decline-call").addEventListener("click", rejectCall);
  document.querySelector("#end-call").addEventListener("click", () => endCurrentCall());

  return {
    endCurrentCall,
    handleAccepted,
    handleDisconnect,
    handleEnded,
    handleIncoming,
    handleSignal,
  };
};
