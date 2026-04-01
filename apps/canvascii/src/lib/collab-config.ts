export const canvasciiCollabConfig = {
  url: process.env.NEXT_PUBLIC_CANVASCII_COLLAB_URL || 'ws://127.0.0.1:5002',
  authToken: process.env.NEXT_PUBLIC_CANVASCII_COLLAB_TOKEN || 'better-auth-session',
} as const
