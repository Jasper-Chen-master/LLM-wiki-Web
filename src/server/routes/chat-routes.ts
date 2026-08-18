import { Router } from "express";
import { CreateChatThreadSchema, SendChatMessageSchema } from "../../shared/contracts.js";
import { ChatApiError, ChatService } from "../services/chat-service.js";
import type { Store } from "../store.js";

export function createChatRouter(store: Store) {
  const router = Router({ mergeParams: true });
  const service = new ChatService(store);
  const param = (params: Record<string, string | undefined>, name: string) => String(params[name] ?? "");
  router.get("/threads", (req, res, next) => { try { res.json(service.listThreads(param(req.params, "id"))); } catch (error) { next(error); } });
  router.post("/threads", async (req, res, next) => {
    const parsed = CreateChatThreadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try { res.status(201).json(await service.saveThread(param(req.params, "id"), parsed.data.title)); } catch (error) { next(error); }
  });
  router.delete("/threads/:threadId", async (req, res, next) => {
    try {
      await service.deleteThread(param(req.params, "id"), param(req.params, "threadId"));
      res.status(204).end();
    } catch (error) { next(error); }
  });
  router.get("/threads/:threadId/messages", (req, res, next) => { try { res.json(service.messages(param(req.params, "id"), param(req.params, "threadId"))); } catch (error) { next(error); } });
  router.post("/threads/:threadId/messages", async (req, res, next) => {
    const parsed = SendChatMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try { res.status(201).json(await service.send(param(req.params, "id"), param(req.params, "threadId"), parsed.data.message)); } catch (error) { next(error); }
  });
  return router;
}

export const chatErrorStatus = (error: unknown) => error instanceof ChatApiError ? error.status : undefined;
