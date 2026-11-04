import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { hasDownloadAccess, permissionsSupported, removeDownloadAccess, requestDownloadAccess } from '@/lib/permissions'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClearRecent: () => void
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsDialog({ open, onOpenChange, onClearRecent }: Props) {
  const [granted, setGranted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && permissionsSupported) void hasDownloadAccess().then(setGranted)
  }, [open])

  const toggle = async () => {
    setBusy(true)
    try {
      if (granted) await removeDownloadAccess()
      else await requestDownloadAccess()
      setGranted(await hasDownloadAccess())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Everything runs on your device. Nothing is uploaded.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <Section title="Open downloads and links here">
            <p className="text-muted-foreground">
              To show a presentation you download or right-click, the extension has to read that file once. Turn this on
              to allow it; you can turn it off at any time. Without it, you can still open files with the button or by
              dropping them on this page.
            </p>
            {permissionsSupported ? (
              <div className="flex items-center gap-3 pt-1">
                <Button size="sm" variant={granted ? 'outline' : 'default'} disabled={busy || granted === null} onClick={() => void toggle()}>
                  {granted ? 'Turn off' : 'Turn on'}
                </Button>
                <span className="text-muted-foreground" role="status">
                  {granted === null ? '' : granted ? 'On: downloads open in the viewer' : 'Off'}
                </span>
              </div>
            ) : (
              <p className="pt-1 text-muted-foreground">Available when installed as an extension.</p>
            )}
          </Section>

          <Section title="Files on your computer">
            <p className="text-muted-foreground">
              To open local presentations (double-clicking or file:// links), also turn on “Allow access to file URLs” for
              this extension on the chrome://extensions page.
            </p>
          </Section>

          <Section title="Recent files">
            <p className="text-muted-foreground">
              The last few files you opened are kept in this browser so you can reopen them. They are never sent anywhere.
            </p>
            <Button size="sm" variant="outline" onClick={onClearRecent}>Clear recent files</Button>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
