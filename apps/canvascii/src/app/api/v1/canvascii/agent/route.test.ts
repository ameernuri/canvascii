import { describe, expect, it } from 'vitest'
import { getAgentRouteErrorStatus, isSharePolicyAction, normalizeAgentRouteErrorMessage } from './route'
import type { CanvasAgentAction } from '@/lib/canvascii/agent-edit'

describe('canvas agent route action classification', () => {
  it('treats canvas link sharing as a share-policy action', () => {
    const action: CanvasAgentAction = {
      type: 'share_canvas_link',
      token: 'token-1',
      access: 'view',
    }

    expect(isSharePolicyAction(action)).toBe(true)
  })

  it('treats link unshare actions as share-policy actions', () => {
    const canvasAction: CanvasAgentAction = {
      type: 'unshare_canvas_link',
      token: 'token-1',
    }
    const portalAction: CanvasAgentAction = {
      type: 'unshare_portal_link',
      portalId: 'portal-1',
      token: 'token-2',
    }

    expect(isSharePolicyAction(canvasAction)).toBe(true)
    expect(isSharePolicyAction(portalAction)).toBe(true)
  })

  it('treats grant edit and revoke actions as share-policy actions', () => {
    const updateAction: CanvasAgentAction = {
      type: 'update_grant',
      grantId: 'grant-1',
      access: 'edit',
      allowCanvasView: true,
    }
    const revokeAction: CanvasAgentAction = {
      type: 'revoke_grant',
      grantId: 'grant-2',
      revokeCompanionCanvasGrant: true,
    }

    expect(isSharePolicyAction(updateAction)).toBe(true)
    expect(isSharePolicyAction(revokeAction)).toBe(true)
  })

  it('treats portal link sharing as a share-policy action', () => {
    const action: CanvasAgentAction = {
      type: 'share_portal_link',
      portalId: 'portal-1',
      token: 'token-1',
      access: 'edit',
      allowCanvasView: true,
    }

    expect(isSharePolicyAction(action)).toBe(true)
  })

  it('does not treat editor mutations as share-policy actions', () => {
    const action: CanvasAgentAction = {
      type: 'create_text',
      row: 4,
      col: 12,
      lines: ['hello'],
    }

    expect(isSharePolicyAction(action)).toBe(false)
  })

  it('classifies stale canvas writes as precondition failures', () => {
    expect(getAgentRouteErrorStatus('Canvas has changed since it was opened.')).toBe(412)
  })

  it('classifies live revision mismatches as conflicts', () => {
    expect(getAgentRouteErrorStatus('Revision mismatch. Expected 10, got 12. Re-read before mutating.')).toBe(409)
  })

  it('adds retry guidance to stale-write errors', () => {
    expect(normalizeAgentRouteErrorMessage('Canvas has changed since it was opened.')).toBe(
      'Canvas has changed since it was opened. Re-read the canvas, then retry the action.',
    )
  })

  it('adds retry guidance to revision mismatches', () => {
    expect(
      normalizeAgentRouteErrorMessage('Revision mismatch. Expected 10, got 12. Re-read before mutating.'),
    ).toBe('Revision mismatch. Expected 10, got 12. Re-read before mutating. Re-read the canvas, then retry the action.')
  })
})
