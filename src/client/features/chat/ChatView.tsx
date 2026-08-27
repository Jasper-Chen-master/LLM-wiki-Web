import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { ChatClaim, ChatCitation, ChatMessage, ChatThread, ProjectSnapshot } from "../../../shared/contracts";
import { readableChatContent, renderChatText } from "../../lib/rich-text";
import { Alert, PageHeader } from "../../components/ui";
import { useI18n, type Language } from "../../i18n";
import { api } from "../../api";

export function ChatClaimStatuses({ claims }: { claims: ChatClaim[] }) {
  const { t } = useI18n();
  const counts = claims.reduce<Record<string, number>>((current, claim) => ({ ...current, [claim.status]: (current[claim.status] ?? 0) + 1 }), {});
  return <div className="chat-claims">{Object.entries(counts).map(([status, count]) => <span key={status} className={`claim-status ${status}`}>{status === "observed" ? t.observed : status === "inferred" ? t.inferenceNotice : t.reported} × {count}</span>)}</div>;
}
function chatCitationLabel(citation: ChatCitation, language: Language, pageLabel: string, snapshot: ProjectSnapshot) {
  const documentName = citation.documentName.replace(/\.(pdf|docx)$/i, "");
  const location = language === "zh" ? `第 ${citation.page} 页` : `${pageLabel} ${citation.page}`;
  const citedNode = citation.nodeId ? snapshot.nodes.find(node => node.id === citation.nodeId) : undefined;
  const evidenceNode = snapshot.nodes.find(node => node.evidenceIds.includes(citation.evidenceId));
  const topic = citation.topic ?? citedNode?.displayName ?? evidenceNode?.displayName ?? citation.section;
  return [documentName, location, topic].filter(Boolean).join(" · ");
}
export function ChatView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t, lang } = useI18n();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const ready = snapshot.job?.status === "completed" && snapshot.nodes.length > 0;
  const loadThreads = useCallback(async () => {
    const next = await api.chatThreads(snapshot.project.id);
    setThreads(next);
    setActiveThreadId((current) => current && next.some((thread) => thread.id === current) ? current : (next[0]?.id ?? ""));
  }, [snapshot.project.id]);
  useEffect(() => { void loadThreads().catch((reason: Error) => setError(reason.message)); }, [loadThreads]);
  useEffect(() => {
    if (!activeThreadId) { setMessages([]); return; }
    void api.chatMessages(snapshot.project.id, activeThreadId).then(setMessages).catch((reason: Error) => setError(reason.message));
  }, [activeThreadId, snapshot.project.id]);
  useEffect(() => {
    const messageList = messagesRef.current;
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }, [messages]);
  const createThread = async () => {
    try {
      setError("");
      const thread = await api.createChatThread(snapshot.project.id);
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      setMessages([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.chatCreateError); }
  };
  const deleteThread = async (threadId: string) => {
    if (!window.confirm(t.deleteChatConfirm)) return;
    try {
      setError("");
      await api.deleteChatThread(snapshot.project.id, threadId);
      setThreads((current) => current.filter((thread) => thread.id !== threadId));
      if (activeThreadId === threadId) {
        setActiveThreadId((current) => current === threadId ? "" : current);
        setMessages([]);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.chatDeleteError); }
  };
  const send = async () => {
    const question = draft.trim();
    if (!question || sending || !ready) return;
    try {
      setSending(true); setError("");
      let threadId = activeThreadId;
      let createdThread = false;
      if (!threadId) {
        const thread = await api.createChatThread(snapshot.project.id);
        threadId = thread.id;
        createdThread = true;
      }
      const reply = await api.sendChatMessage(snapshot.project.id, threadId, question);
      if (createdThread) {
        setActiveThreadId(threadId);
        setMessages([reply.user, reply.assistant]);
      } else setMessages((current) => [...current, reply.user, reply.assistant]);
      setDraft("");
      await loadThreads();
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.chatSendError); }
    finally { setSending(false); }
  };
  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };
  const onChatKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };
  return (
    <>
      <PageHeader title={t.chat} subtitle={t.chatSub} actions={<button className="button" disabled={!ready} onClick={() => void createThread()}>{t.newChat}</button>} />
      {!ready ? <Alert message={t.chatUnavailable} /> : null}
      {error ? <Alert message={error} /> : null}
      <section className="chat-layout">
        <aside className="chat-threads">
          {threads.length ? threads.map((thread) => <div key={thread.id} className={`chat-thread ${thread.id === activeThreadId ? "active" : ""}`}><button className="chat-thread-select" onClick={() => setActiveThreadId(thread.id)}><strong>{thread.title}</strong><small>{t.wikiVersion} {thread.wikiRevision}</small></button><button className="chat-thread-delete" type="button" onClick={() => void deleteThread(thread.id)} aria-label={`${t.deleteChat}: ${thread.title}`} title={t.deleteChat}>×</button></div>) : <p className="muted">{t.noChats}</p>}
        </aside>
        <div className="chat-panel">
          <p className="chat-revision">{t.chatReady} · {t.wikiVersion} {snapshot.project.wikiRevision ?? 0}</p>
          <div className="chat-messages" ref={messagesRef} aria-live="polite">
            {messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-message-content">{renderChatText(readableChatContent(message.content))}</div>
              {message.answer?.claims.length ? <ChatClaimStatuses claims={message.answer.claims} /> : null}
              {message.answer?.citations.length ? <div className="chat-citations"><strong>{t.citations}</strong>{message.answer.citations.map((citation) => <span key={citation.evidenceId}>{chatCitationLabel(citation, lang, t.page, snapshot)}</span>)}</div> : null}
              {message.answer?.limitations.length ? <div className="chat-limitations"><strong>{t.limitations}</strong>{message.answer.limitations.map((item) => <span key={item}>{item}</span>)}</div> : null}
            </article>)}
          </div>
          <form className="chat-compose" onSubmit={submitChat}>
            <textarea value={draft} disabled={!ready || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={onChatKeyDown} placeholder={t.askWiki} />
            <button className="button primary" disabled={!ready || sending || !draft.trim()}>{sending ? "…" : t.send}</button>
          </form>
        </div>
      </section>
    </>
  );
}
