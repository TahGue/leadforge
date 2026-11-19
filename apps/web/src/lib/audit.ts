import { prisma, type Prisma } from "@leadforge/database";

export async function audit(params: {
  organizationId: string;
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  requestId?: string | null;
}): Promise<void> {
  // API-key actors are not Users; keep their identity in metadata instead of the FK.
  const apiKeyActor = params.actorId?.startsWith("api-key:") ? params.actorId : null;
  await prisma.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorId: apiKeyActor ? null : (params.actorId ?? null),
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      metadata: apiKeyActor
        ? ({ ...((params.metadata as Record<string, unknown> | undefined) ?? {}), actor: apiKeyActor } as Prisma.InputJsonValue)
        : (params.metadata ?? {}),
      ip: params.ip ?? null,
      requestId: params.requestId ?? null,
    },
  });
}

/** Transactional outbox write — emitted with the state change it describes. */
export async function emit(
  tx: Prisma.TransactionClient,
  params: {
    organizationId?: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await tx.domainEvent.create({
    data: {
      organizationId: params.organizationId ?? null,
      type: params.type,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      payload: params.payload ?? {},
    },
  });
}
