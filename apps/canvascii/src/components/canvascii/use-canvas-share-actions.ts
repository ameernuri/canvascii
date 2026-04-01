'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { CanvasAccessMode, CanvasPortal, CanvasResolvedPortalAccess } from '@canvascii/core'
import { canvasLibraryApi, type CanvasDetail, type CanvasShareDetail } from '@/lib/canvas-library-api'
import type { AppState } from '@/components/asciip-core/store/appSlice'

const PORTAL_COLOR_PALETTE = ['#38bdf8', '#22c55e', '#f97316', '#f43f5e', '#facc15', '#a855f7']

function resolveOptimisticPortalAccess(canvas: CanvasDetail, portal: CanvasPortal): CanvasResolvedPortalAccess {
  const existing = canvas.accessSummary.portals.find((entry) => entry.id === portal.id)
  const fallbackAccess: CanvasAccessMode =
    canvas.accessSummary.rootAccess === 'owner'
      ? 'owner'
      : canvas.accessSummary.canEditAnywhere
        ? 'edit'
        : canvas.accessSummary.rootAccess

  return {
    ...portal,
    access: existing?.access ?? fallbackAccess,
  }
}

function withOptimisticPortals(canvas: CanvasDetail, portals: CanvasPortal[]): CanvasDetail {
  const now = new Date().toISOString()
  return {
    ...canvas,
    sharePolicy: {
      ...canvas.sharePolicy,
      portals,
      updatedAt: now,
    },
    accessSummary: {
      ...canvas.accessSummary,
      portals: portals.map((portal) => resolveOptimisticPortalAccess(canvas, portal)),
    },
    revision: canvas.revision + 1,
    updatedAt: now,
  }
}

function mergeShareDetail(canvas: CanvasDetail, update: CanvasShareDetail): CanvasDetail {
  return {
    ...canvas,
    id: update.id,
    storageKey: update.storageKey,
    name: update.name,
    title: update.title,
    sizeBytes: canvas.sizeBytes,
    revision: update.revision,
    updatedAt: update.updatedAt,
    etag: update.etag,
    ownerUserId: update.ownerUserId,
    ownerEmail: update.ownerEmail,
    isShared: update.isShared,
    accessSummary: update.accessSummary,
    documentId: update.documentId,
    sharePolicy: update.sharePolicy,
  }
}

export function useCanvasShareActions({
  selectedFile,
  draftState,
  canManageSharing,
  upsertFileSummaryFromDetail,
  setSelectedFile,
  setDraftState,
  setNotice,
}: {
  selectedFile: CanvasDetail | null
  draftState?: AppState | null
  canManageSharing: boolean
  upsertFileSummaryFromDetail: (detail: CanvasDetail) => void
  setSelectedFile: (detail: CanvasDetail | null) => void
  setDraftState?: (state: AppState) => void
  setNotice: (notice: { tone: 'success' | 'error' | 'info'; message: string } | null) => void
}) {
  const latestSelectedFileRef = useRef<CanvasDetail | null>(selectedFile)

  useEffect(() => {
    latestSelectedFileRef.current = selectedFile
  }, [selectedFile])

  const applyOptimisticDetail = useCallback((detail: CanvasDetail) => {
    latestSelectedFileRef.current = detail
    setSelectedFile(detail)
    upsertFileSummaryFromDetail(detail)
  }, [setSelectedFile, upsertFileSummaryFromDetail])

  const handleShareOnlyAction = useCallback(
    async (action: Record<string, unknown>, options?: { editorState?: AppState | null }) => {
      if (!selectedFile) return null
      const updated = await canvasLibraryApi.applyAgentShareAction({
        id: selectedFile.id,
        action,
        editorState: options?.editorState ? (options.editorState as unknown as Record<string, unknown>) : undefined,
      })
      const current = latestSelectedFileRef.current
      const base = current?.id === updated.id ? current : selectedFile
      if (base && base.revision <= updated.revision) {
        const merged = mergeShareDetail(base, updated)
        latestSelectedFileRef.current = merged
        setSelectedFile(merged)
        upsertFileSummaryFromDetail(merged)
        setNotice({ tone: 'success', message: 'Sharing updated.' })
        return merged
      }

      setNotice({ tone: 'success', message: 'Sharing updated.' })
      return current ?? selectedFile
    },
    [selectedFile, setNotice, setSelectedFile, upsertFileSummaryFromDetail],
  )

  const handleShareAction = useCallback(
    async (action: Record<string, unknown>, options?: { editorState?: AppState | null }) => {
      if (!selectedFile) return null
      const updated = await canvasLibraryApi.applyAgentAction({
        id: selectedFile.id,
        action,
        editorState: options?.editorState ? (options.editorState as unknown as Record<string, unknown>) : undefined,
      })
      const current = latestSelectedFileRef.current
      const accepted = !(current && current.id === updated.id && current.revision > updated.revision)
      if (accepted) {
        latestSelectedFileRef.current = updated
        setSelectedFile(updated)
        if (options?.editorState && setDraftState) {
          setDraftState((updated.editorState as AppState) ?? options.editorState)
        }
        upsertFileSummaryFromDetail(updated)
      }
      setNotice({ tone: 'success', message: 'Sharing updated.' })
      return accepted ? updated : current ?? selectedFile
    },
    [selectedFile, setDraftState, setNotice, setSelectedFile, upsertFileSummaryFromDetail],
  )

  const handleCreatePortalFromBounds = useCallback(
    async (bounds: { top: number; left: number; width: number; height: number }) => {
      if (!selectedFile || !canManageSharing) return
      const nextPortalIndex = selectedFile.sharePolicy.portals.length + 1
      const previousFile = selectedFile
      const now = new Date().toISOString()
      const activeCanvasId =
        draftState?.activeDiagramId ??
        ((previousFile.editorState as { activeDiagramId?: string } | undefined)?.activeDiagramId ?? previousFile.documentId)
      const nextPortal: CanvasPortal = {
        id: `optimistic-portal:${Date.now()}`,
        canvasId: activeCanvasId,
        label: `Fence ${nextPortalIndex}`,
        rect: {
          top: bounds.top,
          left: bounds.left,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        },
        color: PORTAL_COLOR_PALETTE[(nextPortalIndex - 1) % PORTAL_COLOR_PALETTE.length],
        createdAt: now,
        updatedAt: now,
      }
      applyOptimisticDetail(withOptimisticPortals(previousFile, [...previousFile.sharePolicy.portals, nextPortal]))
      try {
        await handleShareOnlyAction({
          type: 'add_portal',
          canvasId: nextPortal.canvasId,
          label: nextPortal.label,
          top: nextPortal.rect.top,
          left: nextPortal.rect.left,
          width: nextPortal.rect.width,
          height: nextPortal.rect.height,
          color: nextPortal.color,
        })
      } catch (error) {
        applyOptimisticDetail(previousFile)
        throw error
      }
    },
    [applyOptimisticDetail, canManageSharing, draftState, handleShareOnlyAction, selectedFile],
  )

  const handleUpdatePortal = useCallback(
    async (input: {
      portalId: string
      top: number
      left: number
      width: number
      height: number
      label?: string
      color?: string
    }) => {
      if (!selectedFile || !canManageSharing) return
      const previousFile = selectedFile
      const nextPortals = previousFile.sharePolicy.portals.map((portal) =>
        portal.id === input.portalId
          ? {
              ...portal,
              label: input.label ?? portal.label,
              color: input.color ?? portal.color,
              rect: {
                top: input.top,
                left: input.left,
                width: Math.max(1, input.width),
                height: Math.max(1, input.height),
              },
              updatedAt: new Date().toISOString(),
            }
          : portal,
      )
      applyOptimisticDetail(withOptimisticPortals(previousFile, nextPortals))
      try {
        await handleShareOnlyAction(
          {
            type: 'update_portal',
            portalId: input.portalId,
            top: input.top,
            left: input.left,
            width: Math.max(1, input.width),
            height: Math.max(1, input.height),
            ...(input.label ? { label: input.label } : {}),
            ...(input.color ? { color: input.color } : {}),
          },
          {
            editorState: draftState,
          },
        )
      } catch (error) {
        applyOptimisticDetail(previousFile)
        throw error
      }
    },
    [applyOptimisticDetail, canManageSharing, draftState, handleShareOnlyAction, selectedFile],
  )

  const handleDeletePortal = useCallback(
    async (portalId: string) => {
      if (!selectedFile || !canManageSharing) return
      const previousFile = selectedFile
      applyOptimisticDetail(
        withOptimisticPortals(
          previousFile,
          previousFile.sharePolicy.portals.filter((portal) => portal.id !== portalId),
        ),
      )
      try {
        await handleShareOnlyAction({
          type: 'delete_portal',
          portalId,
        })
      } catch (error) {
        applyOptimisticDetail(previousFile)
        throw error
      }
    },
    [applyOptimisticDetail, canManageSharing, handleShareOnlyAction, selectedFile],
  )

  return {
    handleShareAction,
    handleCreatePortalFromBounds,
    handleUpdatePortal,
    handleDeletePortal,
  }
}
