import { apiError, apiSuccess } from '@/lib/server/api'
import { resolveAuthSession } from '@/lib/server/auth'
import {
  extractCanvasShareToken,
  getWritableCanvasShare,
  getWritableCanvasDetail,
} from '@/lib/server/canvas-access'
import { CanvasLibraryStore } from '@/lib/server/canvas-library-store'
import {
  applyPortalMoveToEditorState,
  applyAgentActionToEditorState,
  applyAgentActionToSharePolicy,
  shouldMovePortalContents,
  type CanvasAgentAction,
} from '@/lib/canvascii/agent-edit'

export const runtime = 'nodejs'

const store = new CanvasLibraryStore()

export function getAgentRouteErrorStatus(message: string) {
  if (message.includes('not found')) return 404
  if (message.includes('already exists')) return 409
  if (message.includes('changed since it was opened')) return 412
  if (message.includes('Revision mismatch')) return 409
  if (message.includes('outside the areas you can edit')) return 403
  if (message.includes('view access')) return 403
  if (message.includes('required')) return 400
  return 500
}

export function normalizeAgentRouteErrorMessage(message: string) {
  if (message.includes('changed since it was opened')) {
    return 'Canvas has changed since it was opened. Re-read the canvas, then retry the action.'
  }
  if (message.includes('Revision mismatch')) {
    return `${message} Re-read the canvas, then retry the action.`
  }
  return message
}

type CanvasSharePolicyAction = Extract<
  CanvasAgentAction,
  { type: 'add_portal' | 'update_portal' | 'delete_portal' | 'share_canvas' | 'share_canvas_link' | 'unshare_canvas_link' | 'share_portal' | 'share_portal_link' | 'unshare_portal_link' | 'update_grant' | 'revoke_grant' }
>

type CanvasPortalAction = Extract<CanvasAgentAction, { type: 'add_portal' | 'update_portal' | 'delete_portal' }>

export function isSharePolicyAction(action: CanvasAgentAction): action is CanvasSharePolicyAction {
  return (
    action.type === 'add_portal' ||
    action.type === 'update_portal' ||
    action.type === 'delete_portal' ||
    action.type === 'share_canvas' ||
    action.type === 'share_canvas_link' ||
    action.type === 'unshare_canvas_link' ||
    action.type === 'share_portal' ||
    action.type === 'share_portal_link' ||
    action.type === 'unshare_portal_link' ||
    action.type === 'update_grant' ||
    action.type === 'revoke_grant'
  )
}

export function isPortalAction(action: CanvasAgentAction): action is CanvasPortalAction {
  return action.type === 'add_portal' || action.type === 'update_portal' || action.type === 'delete_portal'
}

export async function POST(request: Request) {
  const session = await resolveAuthSession(request)
  const shareToken = extractCanvasShareToken(request)
  if (!session && !shareToken) {
    return apiError(401, 'Authentication required.')
  }

  const body = (await request.json().catch(() => null)) as
    | {
        id?: string
        action?: CanvasAgentAction
        editorState?: Record<string, unknown>
        responseMode?: 'full' | 'share-only'
      }
    | null

  if (!body?.id || !body.action) {
    return apiError(400, 'Canvas id and action are required.')
  }
  const action = body.action

  try {
    if (isSharePolicyAction(action)) {
      if (isPortalAction(action)) {
        const resolved = await getWritableCanvasShare(store, {
          id: body.id,
          session,
          shareToken,
        })
        if (!resolved.detail || !resolved.principal) {
          return apiError(403, 'You only have view access to this canvas.')
        }

        const current = resolved.detail
        const currentPortal =
          action.type === 'update_portal'
            ? current.sharePolicy.portals.find((portal) => portal.id === action.portalId) ?? null
            : null
        const nextPolicy = applyAgentActionToSharePolicy(
          current.sharePolicy,
          action,
          action.type === 'add_portal' && action.canvasId ? action.canvasId : current.documentId,
        )
        const nextPortal =
          action.type === 'update_portal'
            ? nextPolicy.portals.find((portal) => portal.id === action.portalId) ?? null
            : null

        if (
          action.type === 'update_portal' &&
          currentPortal &&
          nextPortal &&
          shouldMovePortalContents(currentPortal, nextPortal.rect, action.moveContents)
        ) {
          const fullResolved = await getWritableCanvasDetail(store, {
            id: body.id,
            session,
            shareToken,
          })
          if (!fullResolved.detail || !fullResolved.principal) {
            return apiError(403, 'You only have view access to this canvas.')
          }

          const nextEditorState = applyPortalMoveToEditorState(
            (body.editorState as never) ?? (fullResolved.detail.editorState as never),
            currentPortal,
            nextPortal.rect,
          )
          const detail = await store.saveAccessibleEditorStateAndSharePolicy(fullResolved.principal, {
            id: body.id,
            editorState: nextEditorState as Record<string, unknown>,
            sharePolicy: nextPolicy,
          })
          return apiSuccess(detail)
        }

        const detail = await store.saveAccessibleSharePolicy(resolved.principal, body.id, nextPolicy)
        if (body.responseMode === 'share-only') {
          return apiSuccess(detail)
        }

        const refreshed = await store.getAccessibleById(resolved.principal, body.id)
        return apiSuccess(refreshed ?? detail)
      }

      if (!session) {
        return apiError(401, 'Authentication required.')
      }

      const principal = {
        userId: session.user.id,
        email: session.user.email ?? null,
      }

      const current = await store.getAccessibleById(principal, body.id)
      if (!current) {
        return apiError(404, 'Canvas not found.')
      }

      if (current.ownerUserId !== session.user.id) {
        return apiError(403, 'Only the canvas owner can change sharing.')
      }

      const nextPolicy = applyAgentActionToSharePolicy(
        current.sharePolicy,
        action,
        current.editorState && typeof current.editorState === 'object' && 'activeDiagramId' in current.editorState
          ? (current.editorState.activeDiagramId as string)
          : current.documentId,
      )

      const detail = await store.saveSharePolicy(session.user.id, body.id, nextPolicy)
      if (body.responseMode === 'share-only') {
        return apiSuccess(detail)
      }

      const refreshed = await store.getAccessibleById(principal, body.id)
      return apiSuccess(refreshed ?? detail)
    }

    const resolved = await getWritableCanvasDetail(store, {
      id: body.id,
      session,
      shareToken,
    })
    if (!resolved.detail || !resolved.principal) {
      return apiError(403, 'You only have view access to this canvas.')
    }

    const current = resolved.detail
    const nextEditorState = applyAgentActionToEditorState(current.editorState as never, action)
    const detail = await store.updateAccessible(resolved.principal, {
      id: body.id,
      editorState: nextEditorState as Record<string, unknown>,
      ifMatchEtag: current.etag,
    })

    return apiSuccess(detail)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply agent action.'
    return apiError(getAgentRouteErrorStatus(message), normalizeAgentRouteErrorMessage(message))
  }
}
