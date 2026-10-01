import { a as createRoot, j as jsxRuntimeExports } from './chunks/client.Dx2diFY8.js';
import { r as reactExports } from './chunks/react-vendor.C2UWgpFO.js';

const QuickActionsModal = ({ type, onClose, onSave, currentContact }) => {
  const [value, setValue] = reactExports.useState("");
  const [selectedStatus, setSelectedStatus] = reactExports.useState("new_lead");
  const statuses = [
    { value: "new_lead", label: "New Lead", color: "#3B82F6" },
    { value: "contacted", label: "Contacted", color: "#F59E0B" },
    { value: "qualified", label: "Qualified", color: "#8B5CF6" },
    { value: "won", label: "Won", color: "#10B981" },
    { value: "lost", label: "Lost", color: "#EF4444" }
  ];
  const handleSave = () => {
    if (type === "tag" && value.trim()) {
      onSave({ type: "tag", value: value.trim() });
    } else if (type === "status") {
      onSave({ type: "status", value: selectedStatus });
    } else if (type === "note" && value.trim()) {
      onSave({ type: "note", value: value.trim() });
    }
    onClose();
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1e6
  }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
    background: "white",
    borderRadius: "12px",
    padding: "24px",
    width: "400px",
    maxWidth: "90%",
    boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)"
  }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("h3", { style: { margin: "0 0 16px 0", fontSize: "18px", fontWeight: "bold" }, children: [
      type === "tag" && "🏷️ Add Tag",
      type === "status" && "📊 Set Status",
      type === "note" && "📝 Add Note"
    ] }),
    currentContact && /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { style: { margin: "0 0 16px 0", fontSize: "13px", color: "#666" }, children: [
      "Contact: ",
      /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: currentContact })
    ] }),
    type === "tag" && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      "input",
      {
        type: "text",
        placeholder: "Enter tag name (e.g., VIP, Follow-up)",
        value,
        onChange: (e) => setValue(e.target.value),
        style: {
          width: "100%",
          padding: "10px",
          border: "1px solid #ddd",
          borderRadius: "6px",
          fontSize: "14px",
          marginBottom: "16px"
        },
        autoFocus: true
      }
    ) }),
    type === "status" && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { marginBottom: "16px" }, children: statuses.map((status) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "label",
      {
        style: {
          display: "flex",
          alignItems: "center",
          padding: "10px",
          marginBottom: "8px",
          border: selectedStatus === status.value ? `2px solid ${status.color}` : "1px solid #ddd",
          borderRadius: "6px",
          cursor: "pointer",
          background: selectedStatus === status.value ? `${status.color}15` : "white"
        },
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              type: "radio",
              name: "status",
              value: status.value,
              checked: selectedStatus === status.value,
              onChange: (e) => setSelectedStatus(e.target.value),
              style: { marginRight: "10px" }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            background: status.color,
            marginRight: "8px"
          } }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontWeight: "500" }, children: status.label })
        ]
      },
      status.value
    )) }),
    type === "note" && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
      "textarea",
      {
        placeholder: "Enter your note here...",
        value,
        onChange: (e) => setValue(e.target.value),
        rows: 4,
        style: {
          width: "100%",
          padding: "10px",
          border: "1px solid #ddd",
          borderRadius: "6px",
          fontSize: "14px",
          marginBottom: "16px",
          resize: "vertical",
          fontFamily: "inherit"
        },
        autoFocus: true
      }
    ) }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: "10px", justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          onClick: onClose,
          style: {
            padding: "10px 20px",
            border: "1px solid #ddd",
            borderRadius: "6px",
            background: "white",
            cursor: "pointer",
            fontSize: "14px"
          },
          children: "Cancel"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          onClick: handleSave,
          disabled: type !== "status" && !value.trim(),
          style: {
            padding: "10px 20px",
            border: "none",
            borderRadius: "6px",
            background: "#25D366",
            color: "white",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "500",
            opacity: type !== "status" && !value.trim() ? 0.5 : 1
          },
          children: "Save"
        }
      )
    ] })
  ] }) });
};
const WhatsAppWorkspaceModal = ({ phone, workspaceName, onClose, onLinkToCurrent, onCreate, linking, creating, error }) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1e6
}, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
  background: "white",
  borderRadius: "12px",
  padding: "24px",
  width: "360px",
  maxWidth: "95%",
  boxShadow: "0 10px 40px rgba(0,0,0,0.2)"
}, children: [
  /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { style: { margin: "0 0 8px 0", fontSize: "18px", fontWeight: "bold" }, children: "Link WhatsApp to a workspace" }),
  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "0 0 16px 0", fontSize: "13px", color: "#666" }, children: "This number is used for this browser session and cannot be changed here." }),
  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: {
    padding: "12px",
    background: "#f0f9ff",
    borderRadius: "8px",
    marginBottom: "16px",
    fontFamily: "monospace",
    fontSize: "16px",
    fontWeight: "600",
    color: "#0369a1"
  }, children: phone }),
  error && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "0 0 12px 0", fontSize: "12px", color: "#b91c1c" }, children: error }),
  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", flexDirection: "column", gap: "10px" }, children: [
    workspaceName && /* @__PURE__ */ jsxRuntimeExports.jsx(
      "button",
      {
        type: "button",
        onClick: onLinkToCurrent,
        disabled: linking || creating,
        style: {
          padding: "10px 18px",
          border: "none",
          borderRadius: "8px",
          background: "#25D366",
          color: "white",
          cursor: "pointer",
          fontSize: "14px",
          fontWeight: "600",
          opacity: linking || creating ? 0.7 : 1
        },
        children: linking ? "Linking…" : `Link to «${workspaceName}»`
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { display: "flex", gap: "10px", justifyContent: "flex-end" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          onClick: onClose,
          style: {
            padding: "10px 18px",
            border: "1px solid #ddd",
            borderRadius: "8px",
            background: "white",
            cursor: "pointer",
            fontSize: "14px"
          },
          children: "Later"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          type: "button",
          onClick: onCreate,
          disabled: creating || linking,
          style: {
            padding: "10px 18px",
            border: "none",
            borderRadius: "8px",
            background: workspaceName ? "#128C7E" : "#25D366",
            color: "white",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "600",
            opacity: creating || linking ? 0.7 : 1
          },
          children: creating ? "Creating…" : "Create new workspace"
        }
      )
    ] })
  ] })
] }) });
const Sidebar = () => {
  const [showModal, setShowModal] = reactExports.useState(null);
  const [showWhatsAppWorkspaceModal, setShowWhatsAppWorkspaceModal] = reactExports.useState(false);
  const [whatsappPhone, setWhatsappPhone] = reactExports.useState(null);
  const [creatingWorkspace, setCreatingWorkspace] = reactExports.useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = reactExports.useState(null);
  const [linkingToCurrent, setLinkingToCurrent] = reactExports.useState(false);
  const [linkError, setLinkError] = reactExports.useState(null);
  const [currentWorkspaceName, setCurrentWorkspaceName] = reactExports.useState(null);
  const [currentContact, setCurrentContact] = reactExports.useState("Select a chat");
  const [contactInfo, setContactInfo] = reactExports.useState({
    status: "Active",
    messages: 0,
    tags: []
  });
  const [replyToNewContacts, setReplyToNewContacts] = reactExports.useState(false);
  const readAndSendWhatsAppPhone = () => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem("last-wid-md") : null;
      if (!raw) return;
      const value = typeof raw === "string" ? raw.replace(/^"|"$/g, "").trim() : String(raw);
      const beforeColon = value.split(":")[0];
      const digits = (beforeColon || "").replace(/\D/g, "");
      const phone = digits && digits.length >= 10 ? "+" + digits : null;
      if (phone) chrome.runtime.sendMessage({ type: "WHATSAPP_PHONE_DETECTED", phone }).catch(() => {
      });
    } catch {
    }
  };
  const checkWhatsAppWorkspaceModal = () => {
    readAndSendWhatsAppPhone();
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: "GET_WHATSAPP_WORKSPACE_MODAL_STATE" }, (response) => {
        if (response?.show && response?.phone) {
          setWhatsappPhone(response.phone);
          setCurrentWorkspaceName(response.workspaceName ?? null);
          setShowWhatsAppWorkspaceModal(true);
          setCreateWorkspaceError(null);
          setLinkError(null);
        } else if (response?.phone && response?.workspaceName && !response?.show) {
          setWhatsappPhone(null);
          setCurrentWorkspaceName(null);
        }
      });
    }, 300);
  };
  reactExports.useEffect(() => {
    checkWhatsAppWorkspaceModal();
  }, []);
  reactExports.useEffect(() => {
    const listener = (changes) => {
      if (changes.accessToken || changes.workspace) checkWhatsAppWorkspaceModal();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  const handleLinkToCurrentWorkspace = () => {
    setLinkError(null);
    setCreateWorkspaceError(null);
    setLinkingToCurrent(true);
    chrome.runtime.sendMessage({ type: "LINK_WHATSAPP_PHONE_TO_WORKSPACE" }, (response) => {
      setLinkingToCurrent(false);
      if (response?.success) {
        setShowWhatsAppWorkspaceModal(false);
        setWhatsappPhone(null);
        setCurrentWorkspaceName(null);
      } else {
        setLinkError(response?.error || "Failed to link phone to workspace");
      }
    });
  };
  const handleCreateWorkspaceWithPhone = () => {
    setCreateWorkspaceError(null);
    setLinkError(null);
    setCreatingWorkspace(true);
    chrome.runtime.sendMessage({ type: "CREATE_WORKSPACE_WITH_WHATSAPP_PHONE" }, (response) => {
      setCreatingWorkspace(false);
      if (response?.success) {
        setShowWhatsAppWorkspaceModal(false);
        setWhatsappPhone(null);
        setCurrentWorkspaceName(null);
      } else {
        setCreateWorkspaceError(response?.error || "Failed to create workspace");
      }
    });
  };
  reactExports.useEffect(() => {
    chrome.storage.local.get(["aiConfig"], (result) => {
      if (result.aiConfig?.replyToNewContacts !== void 0) {
        setReplyToNewContacts(result.aiConfig.replyToNewContacts);
      }
    });
  }, []);
  const toggleReplyToNew = async () => {
    const newValue = !replyToNewContacts;
    setReplyToNewContacts(newValue);
    const result = await chrome.storage.local.get(["aiConfig"]);
    const currentConfig = result.aiConfig || {};
    await chrome.storage.local.set({
      aiConfig: { ...currentConfig, replyToNewContacts: newValue }
    });
    console.log("[Sidebar] Reply to new contacts:", newValue);
  };
  reactExports.useEffect(() => {
    const interval = setInterval(() => {
      const headerElement = document.querySelector('[data-testid="conversation-header"]');
      if (headerElement) {
        const nameElement = headerElement.querySelector('span[dir="auto"]');
        if (nameElement?.textContent) {
          setCurrentContact(nameElement.textContent);
        }
      }
    }, 1e3);
    return () => clearInterval(interval);
  }, []);
  const openFullCRM = () => {
    chrome.runtime.sendMessage({ type: "OPEN_CRM" });
  };
  const handleSaveAction = async (data) => {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const action = {
        contact: currentContact,
        type: data.type,
        value: data.value,
        timestamp
      };
      chrome.runtime.sendMessage({
        type: "SAVE_ACTION",
        payload: action
      });
      if (data.type === "tag") {
        setContactInfo((prev) => ({
          ...prev,
          tags: [...prev.tags, data.value]
        }));
      } else if (data.type === "status") {
        setContactInfo((prev) => ({
          ...prev,
          status: data.value
        }));
      }
      alert(`${data.type === "tag" ? "Tag" : data.type === "status" ? "Status" : "Note"} saved successfully!`);
    } catch (error) {
      console.error("Error saving action:", error);
      alert("Error saving. Please try again.");
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "smartdm-sidebar", children: [
    showWhatsAppWorkspaceModal && whatsappPhone && /* @__PURE__ */ jsxRuntimeExports.jsx(
      WhatsAppWorkspaceModal,
      {
        phone: whatsappPhone,
        workspaceName: currentWorkspaceName,
        onClose: () => {
          setShowWhatsAppWorkspaceModal(false);
        },
        onLinkToCurrent: handleLinkToCurrentWorkspace,
        onCreate: handleCreateWorkspaceWithPhone,
        linking: linkingToCurrent,
        creating: creatingWorkspace,
        error: createWorkspaceError || linkError
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-header", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { style: { color: "#25D366", margin: 0, fontSize: "18px" }, children: "WAMarketer" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("p", { style: { margin: "4px 0 0 0", fontSize: "12px", color: "#666" }, children: "WhatsApp CRM Extension" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-content", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginBottom: "12px", padding: "10px", background: "#e8f5e9", borderRadius: "6px", fontSize: "12px" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { color: "#2e7d32" }, children: [
          "✅ ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: "Extension is working!" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { color: "#666", marginTop: "4px" }, children: "📊 Full React CRM coming soon" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          onClick: openFullCRM,
          style: {
            width: "100%",
            padding: "14px",
            marginBottom: "15px",
            background: "linear-gradient(135deg, #25D366 0%, #20BA5A 100%)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(37, 211, 102, 0.3)"
          },
          children: "📊 Open Full CRM Dashboard"
        }
      ),
      !showWhatsAppWorkspaceModal && whatsappPhone && currentWorkspaceName && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginBottom: "15px", padding: "10px", background: "#fff3cd", borderRadius: "8px", fontSize: "12px" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { color: "#856404", marginBottom: "8px" }, children: "Link WhatsApp to this workspace (saved in DB):" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontFamily: "monospace", marginBottom: "8px" }, children: [
          whatsappPhone,
          " → «",
          currentWorkspaceName,
          "»"
        ] }),
        (createWorkspaceError || linkError) && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { color: "#b91c1c", marginBottom: "8px", fontSize: "11px" }, children: createWorkspaceError || linkError }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            onClick: handleLinkToCurrentWorkspace,
            disabled: linkingToCurrent,
            style: {
              width: "100%",
              padding: "8px 12px",
              border: "none",
              borderRadius: "6px",
              background: "#25D366",
              color: "white",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "600",
              opacity: linkingToCurrent ? 0.7 : 1
            },
            children: linkingToCurrent ? "Linking…" : "Link to this workspace"
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "quick-actions", style: { marginBottom: "15px" }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            className: "action-btn",
            onClick: () => setShowModal("tag"),
            style: {
              width: "100%",
              padding: "12px",
              marginBottom: "8px",
              background: "#25D366",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500"
            },
            children: "🏷️ Add Tag"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            className: "action-btn",
            onClick: () => setShowModal("status"),
            style: {
              width: "100%",
              padding: "12px",
              marginBottom: "8px",
              background: "#128C7E",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500"
            },
            children: "📊 Set Status"
          }
        ),
        /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            className: "action-btn",
            onClick: () => setShowModal("note"),
            style: {
              width: "100%",
              padding: "12px",
              background: "#075E54",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "500"
            },
            children: "📝 Add Note"
          }
        )
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
        padding: "12px",
        background: replyToNewContacts ? "#e8f5e9" : "#fff3e0",
        borderRadius: "8px",
        marginBottom: "12px",
        border: replyToNewContacts ? "1px solid #a5d6a7" : "1px solid #ffe0b2"
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px"
        }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
            fontSize: "13px",
            fontWeight: "600",
            color: replyToNewContacts ? "#2e7d32" : "#e65100"
          }, children: replyToNewContacts ? "🤖 AI: New Contacts" : "⏸️ AI: Only Campaigns" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("label", { style: {
            position: "relative",
            display: "inline-block",
            width: "44px",
            height: "24px"
          }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "checkbox",
                checked: replyToNewContacts,
                onChange: toggleReplyToNew,
                style: { opacity: 0, width: 0, height: 0 }
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
              position: "absolute",
              cursor: "pointer",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: replyToNewContacts ? "#25D366" : "#ccc",
              transition: "0.3s",
              borderRadius: "24px"
            }, children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
              position: "absolute",
              content: "",
              height: "18px",
              width: "18px",
              left: replyToNewContacts ? "23px" : "3px",
              bottom: "3px",
              backgroundColor: "white",
              transition: "0.3s",
              borderRadius: "50%"
            } }) })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontSize: "11px", color: "#666" }, children: replyToNewContacts ? "Replying to all new incoming messages" : "Only replying to campaign contacts" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "contact-info", style: {
        padding: "12px",
        background: "#f5f5f5",
        borderRadius: "6px"
      }, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h4", { style: { margin: "0 0 10px 0", fontSize: "13px", fontWeight: "600" }, children: "Quick Info" }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontSize: "12px", color: "#666", lineHeight: "1.6" }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            "• Contact: ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: currentContact })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            "• Status: ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "#25D366" }, children: contactInfo.status })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            "• Messages: ",
            contactInfo.messages
          ] }),
          contactInfo.tags.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { marginTop: "8px" }, children: [
            "Tags: ",
            contactInfo.tags.map((tag, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: {
              display: "inline-block",
              padding: "2px 8px",
              margin: "2px",
              background: "#25D366",
              color: "white",
              borderRadius: "12px",
              fontSize: "11px"
            }, children: tag }, i))
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          onClick: () => {
            const sidebar = document.getElementById("smartdm-sidebar-root");
            if (sidebar?.parentElement?.parentElement) {
              sidebar.parentElement.parentElement.style.display = "none";
            }
          },
          style: {
            width: "100%",
            padding: "10px",
            marginTop: "15px",
            background: "#f5f5f5",
            color: "#666",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "13px"
          },
          children: "Close"
        }
      )
    ] }),
    showModal && /* @__PURE__ */ jsxRuntimeExports.jsx(
      QuickActionsModal,
      {
        type: showModal,
        currentContact,
        onClose: () => setShowModal(null),
        onSave: handleSaveAction
      }
    )
  ] });
};
function ensurePoppinsFont() {
  if (!document.getElementById("smartdm-sidebar-font-style")) {
    const poppins700 = chrome.runtime.getURL("assets/fonts/Poppins-700.ttf");
    const poppins800 = chrome.runtime.getURL("assets/fonts/Poppins-800.ttf");
    const style = document.createElement("style");
    style.id = "smartdm-sidebar-font-style";
    style.textContent = "@font-face { font-family: 'Poppins'; src: url('" + poppins700 + "') format('truetype'); font-weight: 700; font-style: normal; font-display: swap; } @font-face { font-family: 'Poppins'; src: url('" + poppins800 + "') format('truetype'); font-weight: 800; font-style: normal; font-display: swap; } #smartdm-sidebar-root, #smartdm-sidebar-root * { font-family: 'Poppins', 'Segoe UI', sans-serif !important; font-weight: 700 !important; }";
    document.head.appendChild(style);
  }
}
function initSidebar() {
  ensurePoppinsFont();
  const container = document.createElement("div");
  container.id = "smartdm-sidebar-root";
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(/* @__PURE__ */ jsxRuntimeExports.jsx(Sidebar, {}));
}
if (typeof window !== "undefined" && window.location.hostname === "web.whatsapp.com") {
  setTimeout(() => {
    initSidebar();
  }, 2e3);
}
