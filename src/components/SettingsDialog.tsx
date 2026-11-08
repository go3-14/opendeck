import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { setInvertSlides, setTheme, useTheme, type Theme } from '@/lib/theme'
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
  const themeState = useTheme()

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
          <Section title="Appearance">
            <div className="flex gap-1.5">
              {(['auto', 'light', 'dark'] as Theme[]).map((t) => (
                <Button key={t} size="sm" variant={themeState.theme === t ? 'secondary' : 'outline'} onClick={() => setTheme(t)}>
                  {t === 'auto' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
                </Button>
              ))}
            </div>
            <label className="flex items-start gap-2 pt-1.5 text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={themeState.invertSlides}
                onChange={(e) => setInvertSlides(e.target.checked)}
              />
              <span>Invert slide colours in dark mode (pictures stay as they are). Printing and exports are never inverted.</span>
            </label>
          </Section>

          <Section title="Open downloads and links here">
            <p className="text-muted-foreground">
              To show a presentation or PDF you download or right-click, the extension has to read that file once. Turn
              this on to allow it; you can turn it off at any time. Without it, you can still open files with the button
              or by dropping them on this page.
            </p>
            <p className="text-muted-foreground">
              While this is on, links to .pdf files also open here instead of in the browser’s own PDF viewer. Turn it off
              to get the browser’s viewer back.
            </p>
            {permissionsSupported ? (
              <div className="flex items-center gap-3 pt-1">
                <Button size="sm" variant={granted ? 'outline' : 'default'} disabled={busy || granted === null} onClick={() => void toggle()}>
                  {granted ? 'Turn off' : 'Turn on'}
                </Button>
                <span className="text-muted-foreground" role="status">
                  {granted === null ? '' : granted ? 'On: downloads and PDF links open in the viewer' : 'Off'}
                </span>
              </div>
            ) : (
              <p className="pt-1 text-muted-foreground">Available when installed as an extension.</p>
            )}
          </Section>

          <Section title="Files on your computer">
            <p className="text-muted-foreground">
              Windows opens a double-clicked file in the app it has chosen, never in an extension. Files from your
              computer open here by these routes: the Open button, dragging a file onto this page, or a file opened in
              the browser (drag it onto a browser tab, or for a PDF use Open with, Edge or Chrome, or make the browser
              your PDF app).
            </p>
            <p className="text-muted-foreground">
              For files opened in the browser, also turn on “Allow access to file URLs” for this extension on the
              chrome://extensions page, and keep the setting above on.
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
