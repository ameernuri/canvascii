'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Globe2, MailPlus, PanelLeft, Share2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CanvasDetail } from '@/lib/canvas-library-api'
import { buildCanvasShareUrl } from '@/lib/canvas-share-token'
import type { CanvasAgentAction } from '@/lib/canvascii/agent-edit'
import type { CanvasPortal, CanvasShareGrant } from '@canvascii/core'

type ShareTab = 'canvas' | 'portal'

const panelCardClass =
  'border-slate-800/90 bg-slate-950/60 shadow-[inset_0_1px_0_rgba(148,163,184,0.05)]'
const fieldLabelClass = 'text-xs font-medium uppercase tracking-[0.12em] text-slate-400'
const inputClass = 'border-slate-800 bg-slate-950 text-slate-100'
const switchRowClass =
  'flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5'

async function copyTextToClipboard(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall through to the manual copy path below.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is unavailable.')
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  textarea.style.top = '0'
  textarea.style.left = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('Clipboard copy failed.')
  }
}

function formatGrantSubject(
  subjectType: 'user' | 'email' | 'link',
  subjectId: string,
  label?: string | null,
) {
  if (label?.trim()) return label.trim()
  if (subjectType === 'link') return `Link · ${subjectId.slice(0, 8)}`
  return subjectId
}

function getPortalDisplayName(portal: CanvasPortal, index: number) {
  const label = portal.label?.trim()
  return label && label.length > 0 ? label : `Fence ${index + 1}`
}

function isCanvasCompanionGrant(grant: CanvasShareGrant, grants: CanvasShareGrant[]) {
  if (grant.target.type !== 'canvas') return false

  return grants.some(
    (entry) =>
      entry.id !== grant.id &&
      entry.subjectType === grant.subjectType &&
      entry.subjectId === grant.subjectId &&
      entry.target.type === 'portal',
  )
}

const AccessButtons = memo(function AccessButtons({
  value,
  onChange,
  disabled,
}: {
  value: 'view' | 'edit'
  onChange: (value: 'view' | 'edit') => void
  disabled?: boolean
}) {
  return (
    <ButtonGroup className="w-full [&>[data-slot=button]]:flex-1">
      <Button
        type="button"
        size="xs"
        variant={value === 'view' ? 'secondary' : 'outline'}
        className="h-8 w-full border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900 hover:text-slate-100 data-[selected=true]:border-slate-200 data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-950"
        data-selected={value === 'view'}
        disabled={disabled}
        onClick={() => onChange('view')}
      >
        View
      </Button>
      <Button
        type="button"
        size="xs"
        variant={value === 'edit' ? 'secondary' : 'outline'}
        className="h-8 w-full border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-900 hover:text-slate-100 data-[selected=true]:border-slate-200 data-[selected=true]:bg-slate-100 data-[selected=true]:text-slate-950"
        data-selected={value === 'edit'}
        disabled={disabled}
        onClick={() => onChange('edit')}
      >
        Edit
      </Button>
    </ButtonGroup>
  )
})

const CanvasSharePanel = memo(function CanvasSharePanel({
  email,
  access,
  linkAccess,
  canManage,
  submitting,
  copiedTarget,
  onEmailChange,
  onAccessChange,
  onLinkAccessChange,
  onShare,
  onCreateLink,
}: {
  email: string
  access: 'view' | 'edit'
  linkAccess: 'view' | 'edit'
  canManage: boolean
  submitting: boolean
  copiedTarget: string | null
  onEmailChange: (value: string) => void
  onAccessChange: (value: 'view' | 'edit') => void
  onLinkAccessChange: (value: 'view' | 'edit') => void
  onShare: () => void
  onCreateLink: () => void
}) {
  return (
    <div className="space-y-3">
      <Card size="sm" className={panelCardClass}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <MailPlus className="h-4 w-4 text-slate-300" />
            Add people
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="canvas-share-email" className={fieldLabelClass}>
              Email
            </Label>
            <Input
              id="canvas-share-email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="teammate@example.com"
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={fieldLabelClass}>Access</Label>
            <AccessButtons value={access} onChange={onAccessChange} disabled={!canManage || submitting} />
          </div>
          <Button
            className="h-9 w-full bg-slate-100 text-slate-950 hover:bg-white"
            disabled={!canManage || submitting || !email.trim()}
            onClick={onShare}
          >
            {submitting ? 'Sharing…' : 'Add collaborator'}
          </Button>
        </CardContent>
      </Card>

      <Card size="sm" className={panelCardClass}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Globe2 className="h-4 w-4 text-slate-300" />
            Create access link
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className={fieldLabelClass}>Access</Label>
            <AccessButtons value={linkAccess} onChange={onLinkAccessChange} disabled={!canManage || submitting} />
          </div>
          <Button
            className="h-9 w-full border border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900"
            disabled={!canManage || submitting}
            onClick={onCreateLink}
          >
            <Copy className="mr-2 h-4 w-4" />
            {copiedTarget === 'create-canvas' ? 'Link copied' : 'Create access link'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
})

const PortalPickerCard = memo(function PortalPickerCard({
  portalId,
  portals,
  portalNameById,
  onPortalChange,
}: {
  portalId: string
  portals: CanvasPortal[]
  portalNameById: Record<string, string>
  onPortalChange: (value: string) => void
}) {
  return (
    <Card size="sm" className={panelCardClass}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-100">Choose fence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <Label className={fieldLabelClass}>Fence</Label>
        <Select value={portalId} onValueChange={(value) => onPortalChange(value ?? '')} disabled={portals.length === 0}>
          <SelectTrigger className={inputClass}>
            <SelectValue placeholder={portals.length ? 'Select a fence' : 'No fences yet'}>
              {(value) => {
                if (!value) return portals.length ? 'Select a fence' : 'No fences yet'
                return portalNameById[String(value)] ?? 'Unknown fence'
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {portals.map((portal) => (
              <SelectItem
                key={portal.id}
                value={portal.id}
                label={portalNameById[portal.id] ?? portal.id}
              >
                {portalNameById[portal.id] ?? portal.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
})

const PortalSharePanel = memo(function PortalSharePanel({
  selectedPortal,
  selectedPortalName,
  portals,
  portalNameById,
  email,
  access,
  allowCanvasView,
  linkAccess,
  linkAllowCanvasView,
  canManage,
  submitting,
  copiedTarget,
  onPortalChange,
  onEmailChange,
  onAccessChange,
  onAllowCanvasViewChange,
  onLinkAccessChange,
  onLinkAllowCanvasViewChange,
  onShare,
  onCreateLink,
}: {
  selectedPortal: CanvasPortal | null
  selectedPortalName: string | null
  portals: CanvasPortal[]
  portalNameById: Record<string, string>
  email: string
  access: 'view' | 'edit'
  allowCanvasView: boolean
  linkAccess: 'view' | 'edit'
  linkAllowCanvasView: boolean
  canManage: boolean
  submitting: boolean
  copiedTarget: string | null
  onPortalChange: (value: string) => void
  onEmailChange: (value: string) => void
  onAccessChange: (value: 'view' | 'edit') => void
  onAllowCanvasViewChange: (value: boolean) => void
  onLinkAccessChange: (value: 'view' | 'edit') => void
  onLinkAllowCanvasViewChange: (value: boolean) => void
  onShare: () => void
  onCreateLink: () => void
}) {
  return (
    <div className="space-y-3">
      <PortalPickerCard
        portalId={selectedPortal?.id ?? ''}
        portals={portals}
        portalNameById={portalNameById}
        onPortalChange={onPortalChange}
      />

      {selectedPortal ? (
        <>
          <Card size="sm" className={panelCardClass}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <MailPlus className="h-4 w-4 text-slate-300" />
                Add people
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="portal-share-email" className={fieldLabelClass}>
                  Email
                </Label>
                <Input
                  id="portal-share-email"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  placeholder="teammate@example.com"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <Label className={fieldLabelClass}>Access</Label>
                <AccessButtons value={access} onChange={onAccessChange} disabled={!canManage || submitting} />
              </div>
              <div className={switchRowClass}>
                <div>
                  <div className="text-sm font-medium text-slate-100">Allow whole canvas view</div>
                  <div className="text-xs text-slate-400">They can see the rest of the canvas for context.</div>
                </div>
                <Switch checked={allowCanvasView} onCheckedChange={onAllowCanvasViewChange} />
              </div>
              <Button
                className="h-9 w-full bg-slate-100 text-slate-950 hover:bg-white"
                disabled={!canManage || submitting || !email.trim()}
                onClick={onShare}
              >
                {submitting ? 'Sharing…' : `Share ${selectedPortalName ?? 'fence'}`}
              </Button>
            </CardContent>
          </Card>

          <Card size="sm" className={panelCardClass}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Globe2 className="h-4 w-4 text-slate-300" />
                Create access link
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className={fieldLabelClass}>Access</Label>
                <AccessButtons value={linkAccess} onChange={onLinkAccessChange} disabled={!canManage || submitting} />
              </div>
              <div className={switchRowClass}>
                <div>
                  <div className="text-sm font-medium text-slate-100">Allow whole canvas view</div>
                  <div className="text-xs text-slate-400">Without this, the link only exposes the fence.</div>
                </div>
                <Switch checked={linkAllowCanvasView} onCheckedChange={onLinkAllowCanvasViewChange} />
              </div>
              <Button
                className="h-9 w-full border border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900"
                disabled={!canManage || submitting}
                onClick={onCreateLink}
              >
                <Copy className="mr-2 h-4 w-4" />
                {copiedTarget === 'create-portal' ? 'Link copied' : 'Create access link'}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card size="sm" className="border-dashed border-slate-800 bg-slate-950/40">
          <CardContent className="py-8 text-center text-sm text-slate-400">
            Create a fence on the canvas first, then share it here.
          </CardContent>
        </Card>
      )}
    </div>
  )
})

const GrantRow = memo(function GrantRow({
  grant,
  copiedTarget,
  canManage,
  submitting,
  getAllowCanvasView,
  onUpdateGrant,
  onCopyGrantLink,
  onRevokeGrant,
}: {
  grant: CanvasShareGrant
  copiedTarget: string | null
  canManage: boolean
  submitting: boolean
  getAllowCanvasView: (grant: CanvasShareGrant) => boolean
  onUpdateGrant: (grant: CanvasShareGrant, input: { access: 'view' | 'edit'; allowCanvasView?: boolean }) => void
  onCopyGrantLink: (grant: CanvasShareGrant) => void
  onRevokeGrant: (grant: CanvasShareGrant) => void
}) {
  const isPortalGrant = grant.target.type === 'portal'
  const allowCanvasView = isPortalGrant ? getAllowCanvasView(grant) : false
  const copied = copiedTarget === grant.id && grant.subjectType === 'link'

  return (
    <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-100">
            {formatGrantSubject(grant.subjectType, grant.subjectId, grant.label)}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant="outline" className="border-slate-700 text-[10px] uppercase tracking-[0.16em] text-slate-400">
              {grant.subjectType === 'link' ? 'Link' : 'Invite'}
            </Badge>
            {isPortalGrant && allowCanvasView ? (
              <Badge variant="outline" className="border-slate-700 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                Canvas view
              </Badge>
            ) : null}
          </div>
        </div>
        {grant.subjectType === 'link' ? (
          <Badge variant="outline" className="border-slate-700 text-[10px] uppercase tracking-[0.16em] text-slate-400">
            {copied ? 'Copied' : 'Link'}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-2.5">
        <div className="space-y-1.5">
          <Label className={fieldLabelClass}>Access</Label>
          <AccessButtons
            value={grant.access}
            disabled={!canManage || submitting}
            onChange={(value) => onUpdateGrant(grant, { access: value, allowCanvasView })}
          />
        </div>

        {isPortalGrant ? (
          <div className={switchRowClass}>
            <div>
              <div className="text-sm text-slate-100">Allow whole canvas view</div>
              <div className="text-xs text-slate-500">Keeps fence editing scoped, but exposes the rest for context.</div>
            </div>
            <Switch
              checked={allowCanvasView}
              disabled={!canManage || submitting}
              onCheckedChange={(checked) => onUpdateGrant(grant, { access: grant.access, allowCanvasView: checked })}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {grant.subjectType === 'link' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage || submitting}
              onClick={() => onCopyGrantLink(grant)}
            >
              <Copy className="h-4 w-4" />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!canManage || submitting}
            onClick={() => onRevokeGrant(grant)}
          >
            <Trash2 className="h-4 w-4" />
            Revoke
          </Button>
        </div>
      </div>
    </div>
  )
})

const ManageAccessCard = memo(function ManageAccessCard({
  owner,
  rootAccess,
  grantHeading,
  activeGrants,
  copiedTarget,
  canManage,
  submitting,
  getAllowCanvasView,
  onUpdateGrant,
  onCopyGrantLink,
  onRevokeGrant,
}: {
  owner: string
  rootAccess: string
  grantHeading: string
  activeGrants: CanvasShareGrant[]
  copiedTarget: string | null
  canManage: boolean
  submitting: boolean
  getAllowCanvasView: (grant: CanvasShareGrant) => boolean
  onUpdateGrant: (grant: CanvasShareGrant, input: { access: 'view' | 'edit'; allowCanvasView?: boolean }) => void
  onCopyGrantLink: (grant: CanvasShareGrant) => void
  onRevokeGrant: (grant: CanvasShareGrant) => void
}) {
  return (
    <Card size="sm" className={`${panelCardClass} self-start lg:sticky lg:top-0`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-100">Manage access</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-slate-300">
          <div className="flex items-center justify-between gap-3">
            <span>Owner</span>
            <span className="font-medium text-slate-100">{owner}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span>Root access</span>
            <span className="font-medium uppercase tracking-[0.14em] text-slate-100">{rootAccess}</span>
          </div>
        </div>

        <Separator className="bg-slate-800" />

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            {grantHeading}
          </div>
          <div className="space-y-2">
            {activeGrants.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/40 px-3 py-4 text-sm text-slate-500">
                No grants yet.
              </div>
            ) : (
              activeGrants.map((grant) => (
                <GrantRow
                  key={grant.id}
                  grant={grant}
                  copiedTarget={copiedTarget}
                  canManage={canManage}
                  submitting={submitting}
                  getAllowCanvasView={getAllowCanvasView}
                  onUpdateGrant={onUpdateGrant}
                  onCopyGrantLink={onCopyGrantLink}
                  onRevokeGrant={onRevokeGrant}
                />
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
})

export function CanvasShareDialog({
  open,
  onOpenChange,
  file,
  canManage,
  defaultTab = 'canvas',
  initialPortalId = null,
  onApplyAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: CanvasDetail | null
  canManage: boolean
  defaultTab?: ShareTab
  initialPortalId?: string | null
  onApplyAction: (action: CanvasAgentAction) => Promise<void>
}) {
  const [tab, setTab] = useState<ShareTab>(defaultTab)
  const [portalId, setPortalId] = useState('')
  const [canvasEmail, setCanvasEmail] = useState('')
  const [canvasAccess, setCanvasAccess] = useState<'view' | 'edit'>('view')
  const [canvasLinkAccess, setCanvasLinkAccess] = useState<'view' | 'edit'>('view')
  const [portalEmail, setPortalEmail] = useState('')
  const [portalAccess, setPortalAccess] = useState<'view' | 'edit'>('view')
  const [portalAllowCanvasView, setPortalAllowCanvasView] = useState(true)
  const [portalLinkAccess, setPortalLinkAccess] = useState<'view' | 'edit'>('view')
  const [portalLinkAllowCanvasView, setPortalLinkAllowCanvasView] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null)
  const wasOpenRef = useRef(false)

  const portals = useMemo(() => file?.sharePolicy.portals ?? [], [file?.sharePolicy.portals])
  const portalNameById = useMemo(
    () =>
      Object.fromEntries(portals.map((portal, index) => [portal.id, getPortalDisplayName(portal, index)])),
    [portals],
  )

  const selectedPortal = useMemo(
    () => portals.find((portal) => portal.id === portalId) ?? null,
    [portalId, portals],
  )
  const selectedPortalName = selectedPortal ? portalNameById[selectedPortal.id] ?? 'Fence' : null

  const canvasGrants = useMemo(
    () => {
      const grants = file?.sharePolicy.grants ?? []
      return grants.filter((grant) => grant.target.type === 'canvas' && !isCanvasCompanionGrant(grant, grants))
    },
    [file?.sharePolicy.grants],
  )
  const portalGrants = useMemo(
    () =>
      (file?.sharePolicy.grants ?? []).filter(
        (grant) => grant.target.type === 'portal' && grant.target.portalId === portalId,
      ),
    [file?.sharePolicy.grants, portalId],
  )

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const nextPortalId = initialPortalId ?? portals[0]?.id ?? ''
      setTab(defaultTab)
      setPortalId(nextPortalId)
      setCanvasEmail('')
      setCanvasAccess('view')
      setCanvasLinkAccess('view')
      setPortalEmail('')
      setPortalAccess('view')
      setPortalAllowCanvasView(true)
      setPortalLinkAccess('view')
      setPortalLinkAllowCanvasView(true)
      setCopiedTarget(null)
    }

    wasOpenRef.current = open
  }, [defaultTab, initialPortalId, open, portals])

  useEffect(() => {
    if (!portalId && portals[0]?.id) {
      setPortalId(portals[0].id)
    }
  }, [portalId, portals])

  useEffect(() => {
    if (!selectedPortal) return
    setPortalLinkAccess('view')
    setPortalLinkAllowCanvasView(true)
    setCopiedTarget((current) => (current === 'create-portal' ? null : current))
  }, [selectedPortal?.id])

  const submitAction = useCallback(
    async (action: CanvasAgentAction) => {
      setSubmitting(true)
      try {
        await onApplyAction(action)
      } finally {
        setSubmitting(false)
      }
    },
    [onApplyAction],
  )

  const handleCopyCanvasLink = useCallback(async () => {
    if (!file) return

    const token = crypto.randomUUID()
    const shareUrl = buildCanvasShareUrl({
      origin: window.location.origin,
      canvasId: file.id,
      token,
    })
    const copyPromise = copyTextToClipboard(shareUrl)

    await submitAction({
      type: 'share_canvas_link',
      token,
      access: canvasLinkAccess,
    })

    await copyPromise
    setCopiedTarget('create-canvas')
  }, [canvasLinkAccess, file, submitAction])

  const handleCopyPortalLink = useCallback(async () => {
    if (!file || !selectedPortal) return

    const token = crypto.randomUUID()
    const shareUrl = buildCanvasShareUrl({
      origin: window.location.origin,
      canvasId: file.id,
      token,
    })
    const copyPromise = copyTextToClipboard(shareUrl)

    await submitAction({
      type: 'share_portal_link',
      portalId: selectedPortal.id,
      token,
      access: portalLinkAccess,
      allowCanvasView: portalLinkAllowCanvasView,
    })

    await copyPromise
    setCopiedTarget('create-portal')
  }, [file, portalLinkAccess, portalLinkAllowCanvasView, selectedPortal, submitAction])

  const grantHasCanvasContext = useCallback(
    (grant: CanvasShareGrant) => {
      if (!file || grant.target.type !== 'portal') return false

      return file.sharePolicy.grants.some(
        (entry) =>
          entry.id !== grant.id &&
          entry.subjectType === grant.subjectType &&
          entry.subjectId === grant.subjectId &&
          entry.target.type === 'canvas' &&
          entry.access === 'view',
      )
    },
    [file],
  )

  const handleUpdateGrant = useCallback(
    (grant: CanvasShareGrant, input: { access: 'view' | 'edit'; allowCanvasView?: boolean }) => {
      void submitAction({
        type: 'update_grant',
        grantId: grant.id,
        access: input.access,
        ...(grant.target.type === 'portal'
          ? { allowCanvasView: input.allowCanvasView ?? grantHasCanvasContext(grant) }
          : {}),
      })
    },
    [grantHasCanvasContext, submitAction],
  )

  const handleRevokeGrant = useCallback(
    (grant: CanvasShareGrant) => {
      void submitAction({
        type: 'revoke_grant',
        grantId: grant.id,
        revokeCompanionCanvasGrant: grant.target.type === 'portal',
      })
    },
    [submitAction],
  )

  const handleCopyGrantLink = useCallback(
    (grant: CanvasShareGrant) => {
      if (!file || grant.subjectType !== 'link') return

      void copyTextToClipboard(
        buildCanvasShareUrl({
          origin: window.location.origin,
          canvasId: file.id,
          token: grant.subjectId,
        }),
      )
        .then(() => {
          setCopiedTarget(grant.id)
        })
    },
    [file],
  )

  const handleCanvasShare = useCallback(() => {
    void submitAction({
      type: 'share_canvas',
      email: canvasEmail.trim(),
      access: canvasAccess,
    })
  }, [canvasAccess, canvasEmail, submitAction])

  const handlePortalShare = useCallback(() => {
    if (!selectedPortal) return

    void submitAction({
      type: 'share_portal',
      portalId: selectedPortal.id,
      email: portalEmail.trim(),
      access: portalAccess,
      allowCanvasView: portalAllowCanvasView,
    })
  }, [portalAccess, portalAllowCanvasView, portalEmail, selectedPortal, submitAction])

  const activeGrants = tab === 'canvas' ? canvasGrants : portalGrants
  const grantHeading =
    tab === 'canvas'
      ? 'Canvas grants'
      : selectedPortalName
        ? `${selectedPortalName} grants`
        : 'Fence grants'

  if (!file) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86svh] overflow-y-auto border-slate-800 bg-[#0a1018] p-5 text-slate-100 sm:max-w-3xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl">Share canvas</DialogTitle>
          <DialogDescription className="text-slate-400">
            Invite people or create a link for the whole canvas or one fence.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(value) => setTab(value as ShareTab)} className="flex-col gap-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Share scope</div>
            <TabsList className="grid h-10 w-full max-w-sm grid-cols-2 rounded-xl border border-slate-800/80 bg-slate-950/80 p-1 text-slate-400 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]">
              <TabsTrigger
                value="canvas"
                className="gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 data-active:bg-slate-100 data-active:text-slate-950 data-active:shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_10px_24px_rgba(15,23,42,0.32)] dark:data-active:border-transparent dark:data-active:bg-slate-100 dark:data-active:text-slate-950"
              >
                <Share2 className="h-4 w-4" />
                Canvas
              </TabsTrigger>
              <TabsTrigger
                value="portal"
                className="gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 data-active:bg-slate-100 data-active:text-slate-950 data-active:shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_10px_24px_rgba(15,23,42,0.32)] dark:data-active:border-transparent dark:data-active:bg-slate-100 dark:data-active:text-slate-950"
              >
                <PanelLeft className="h-4 w-4" />
                Fence
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.9fr)]">
            <div>
              <TabsContent value="canvas" className="space-y-3">
                <CanvasSharePanel
                  email={canvasEmail}
                  access={canvasAccess}
                  linkAccess={canvasLinkAccess}
                  canManage={canManage}
                  submitting={submitting}
                  copiedTarget={copiedTarget}
                  onEmailChange={setCanvasEmail}
                  onAccessChange={setCanvasAccess}
                  onLinkAccessChange={setCanvasLinkAccess}
                  onShare={handleCanvasShare}
                  onCreateLink={handleCopyCanvasLink}
                />
              </TabsContent>

              <TabsContent value="portal" className="space-y-3">
                <PortalSharePanel
                  selectedPortal={selectedPortal}
                  selectedPortalName={selectedPortalName}
                  portals={portals}
                  portalNameById={portalNameById}
                  email={portalEmail}
                  access={portalAccess}
                  allowCanvasView={portalAllowCanvasView}
                  linkAccess={portalLinkAccess}
                  linkAllowCanvasView={portalLinkAllowCanvasView}
                  canManage={canManage}
                  submitting={submitting}
                  copiedTarget={copiedTarget}
                  onPortalChange={setPortalId}
                  onEmailChange={setPortalEmail}
                  onAccessChange={setPortalAccess}
                  onAllowCanvasViewChange={setPortalAllowCanvasView}
                  onLinkAccessChange={setPortalLinkAccess}
                  onLinkAllowCanvasViewChange={setPortalLinkAllowCanvasView}
                  onShare={handlePortalShare}
                  onCreateLink={handleCopyPortalLink}
                />
              </TabsContent>
            </div>

            <ManageAccessCard
              owner={file.ownerEmail ?? file.ownerUserId}
              rootAccess={file.accessSummary.rootAccess}
              grantHeading={grantHeading}
              activeGrants={activeGrants}
              copiedTarget={copiedTarget}
              canManage={canManage}
              submitting={submitting}
              getAllowCanvasView={grantHasCanvasContext}
              onUpdateGrant={handleUpdateGrant}
              onCopyGrantLink={handleCopyGrantLink}
              onRevokeGrant={handleRevokeGrant}
            />
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
