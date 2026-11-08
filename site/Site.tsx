import { useState } from 'react'
import { DownloadIcon as Download, ExternalLinkIcon as ExternalLink } from '@/components/ui/icons'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Reveal } from './Reveal'
import { useActiveSection } from './hooks/useActiveSection'
import { useScroll } from './hooks/useScroll'

import pkg from '../package.json'
import icon from '../public/icons/icon48.png'
import shotView from '../store/screenshots/1-view.jpg'
import shotSearch from '../store/screenshots/2-search.jpg'
import shotMenu from '../store/screenshots/3-more-menu.jpg'
import shotDark from '../store/screenshots/4-dark.jpg'
import shotSpeaker from '../store/screenshots/5-speaker-view.jpg'

const REPO = 'https://github.com/go3-14/opendeck'
const SECTIONS = ['features', 'how', 'privacy', 'support']

const showcase = [
  { id: 'search', label: 'Search', shot: shotSearch, alt: 'Search results highlighted in the slide list', title: 'Search everything', text: 'Find words in slide text, tables and speaker notes. Matching slides are marked in the slide list.' },
  { id: 'present', label: 'Present', shot: shotSpeaker, alt: 'Speaker view with notes, next slide and a timer', title: 'Present with notes', text: 'A full-screen slideshow that plays animation builds and transitions, with speaker view, laser pointer and pen.' },
  { id: 'export', label: 'Copy and export', shot: shotMenu, alt: 'More menu with copy, print and export options', title: 'Take the content with you', text: 'Copy a slide as an image or text, copy an outline, download the original file, export a PDF, print, and export every slide as PNG.' },
]

// Newest first. The first entry is shown as the current release, so keep it in step with package.json.
const releases = [
  { version: '1.5.0', title: 'Download and export as PDF', text: 'Download the original file you opened, and export a presentation as a real PDF where every page keeps its slide size and orientation.' },
  { version: '1.4.0', title: 'Select and copy text', text: 'Drag over words on a slide or PDF page and press Ctrl+C. PDFs opened from your computer in the browser now open in Opendeck too.' },
  { version: '1.3.0', title: 'PDF files', text: 'PDFs open in the same viewer with search, slideshow, printing and dark mode. Downloads and links to .pdf files can open here.' },
  { version: '1.2.0', title: 'Dark mode and mouse wheel', text: 'Auto, light or dark with inverted slide colours, and scrolling to change slides in the viewer and the slideshow.' },
]

const features = [
  ['Several ways to open files', 'Toolbar icon, drag and drop, recent files, or links you right-click. Optionally, downloads open straight in the viewer.'],
  ['Dark mode', 'Auto, light or dark, with slide colours inverted and pictures left alone. Slides fit your window, or zoom in.'],
  ['Draws what is in the file', 'Master and layout styles, shapes, pictures, tables, charts and SmartArt. Content it cannot draw is clearly marked.'],
  ['Presenter tools', 'Laser pointer, pen, slide grid, black and white screens, jump to any slide, and mouse-wheel paging.'],
  ['PDF files too', 'PDFs open in the same viewer, with search, slideshow, printing and dark mode. Links to .pdf files can open here instead of the browser viewer.'],
  ['Select and copy text', 'Drag over words on a slide or a PDF page and press Ctrl+C. Tables, bullets and rotated text all work.'],
  ['Many formats', '.pptx, .ppsx, .potx and the macro-enabled variants, plus PDF.'],
  ['Download and export', 'Download the original file, export a presentation as a PDF with every page in its own size, print, export slides as PNG, or copy a slide as an image or text. Always in the original colours.'],
  ['Open source', 'MIT licensed, built in the open. Read the code, report problems, send fixes.'],
]

const steps = [
  ['Open a file', 'Click the toolbar icon, choose a file or drop one on the page. Nothing is sent anywhere.'],
  ['Look around', 'Browse slides, search, zoom, or switch the theme. Slides are drawn on demand, so large decks stay quick.'],
  ['Present or reuse', 'Start the slideshow with F5, or copy, print and export what you need.'],
]

const faq = [
  ['A slide looks different from PowerPoint.', 'Opendeck draws slides itself from the file, so very unusual effects can differ. Open an issue with a small example and what you expected. Content it cannot draw is marked on the slide instead of silently dropped.'],
  ['Why did downloads not open in the viewer?', "That feature is optional. Open the extension's Settings and turn on Open downloads and links here. Your browser then asks for access to websites, which is only used to read the file you just downloaded."],
  ['Does it edit presentations?', 'No. Opendeck is a viewer: open, search, present, copy, print and export. Your files are never changed.'],
  ['Can I double-click a file to open it in Opendeck?', 'Windows opens a double-clicked file in the app it has chosen, and an extension cannot change that. Use the toolbar button, drag the file onto the viewer or a browser tab, or for PDFs choose Open with, Edge or Chrome. For files opened in the browser, also turn on Allow access to file URLs for Opendeck on the extensions page of your browser; browsers keep that switch separate and extensions cannot turn it on for you.'],
  ['Can it open PDFs?', 'Yes. PDFs open in the same viewer, with search, slideshow, printing and dark mode. With "Open downloads and links here" on, links to .pdf files open in Opendeck instead of the browser\'s PDF viewer; turn it off to get that viewer back.'],
  ['Is it really free?', 'Yes. It is open source under the MIT licence, with no ads, no accounts and no paid tier.'],
]

const privacy = [
  'Presentations are read and drawn on your device. No uploads, no analytics, no tracking.',
  'Access to websites is optional and off until you turn it on in Settings. It is used only to fetch the file you just downloaded or right-clicked, and you can remove it at any time.',
  'Recent files are kept in your browser only, and Settings can clear them.',
  'This site loads no third-party scripts, fonts or trackers.',
]

function ComingSoon({ name }: { name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
        <Button variant="outline" size="lg" disabled className="pointer-events-none h-10 px-4">
          {name}
          <Badge variant="secondary">Soon</Badge>
        </Button>
      </TooltipTrigger>
      <TooltipContent>The {name} listing is not live yet</TooltipContent>
    </Tooltip>
  )
}

function Header({ scrolled, active }: { scrolled: boolean; active: string }) {
  const link = (id: string, label: string, keep = false) => (
    <a
      key={id}
      href={`#${id}`}
      className={cn(
        'text-sm text-muted-foreground transition-colors hover:text-foreground',
        active === id && 'text-foreground',
        !keep && 'hidden sm:inline',
      )}
    >
      {label}
    </a>
  )
  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-transparent bg-background/80 backdrop-blur transition-[border-color,box-shadow] duration-300',
        scrolled && 'border-border shadow-sm',
      )}
    >
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-5">
        <a href="#top" className="mr-auto flex items-center gap-2.5 font-semibold">
          <img src={icon} alt="" className="size-6" />
          Opendeck
        </a>
        <nav className="flex items-center gap-5">
          {link('features', 'Features')}
          {link('how', 'How it works')}
          {link('privacy', 'Privacy')}
          {link('support', 'Support', true)}
          <a href={REPO} className="text-sm text-muted-foreground transition-colors hover:text-foreground">GitHub</a>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  const enter = 'animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-700 motion-reduce:animate-none'
  return (
    <div className="mx-auto max-w-5xl px-5 pt-16 pb-10 text-center sm:pt-20">
      <Badge variant="secondary" className={cn(enter, 'mb-5')}>Free · Open source · Private</Badge>
      <h1 className={cn(enter, 'mx-auto max-w-[24ch] text-4xl leading-[1.1] font-semibold tracking-tight delay-75 sm:text-5xl')}>
        PowerPoint and PDF files, right in your browser.
      </h1>
      <p className={cn(enter, 'mx-auto mt-4 max-w-xl text-lg text-muted-foreground delay-150')}>
        Opendeck is a free, open-source viewer with search, selectable text and a full-screen slideshow. No upload, no account, no server. Your files stay on your device.
      </p>
      <div className={cn(enter, 'mt-7 flex flex-wrap justify-center gap-2.5 delay-200')}>
        <ComingSoon name="Firefox" />
        <ComingSoon name="Chrome" />
        <ComingSoon name="Edge" />
        <Button size="lg" className="h-10 px-4" nativeButton={false} render={<a href={`${REPO}/releases/latest`} />}>
          <Download /> Download from GitHub
        </Button>
      </div>
      <p className={cn(enter, 'mt-4 text-sm text-muted-foreground delay-300')}>Works in Chrome, Edge, Firefox and Zen. MIT licence.</p>
      <p className={cn(enter, 'mt-2 text-sm delay-300')}>
        <a className="underline underline-offset-4 hover:text-foreground" href={`${REPO}/releases/latest`}>
          Latest: version {pkg.version}, {releases[0].title.toLowerCase()}
        </a>
      </p>

      <div className={cn(enter, 'mt-12 delay-500')}>
        <div
          className="overflow-hidden rounded-xl border bg-muted shadow-sm will-change-transform motion-reduce:transform-none!"
          style={{ transform: 'translateY(calc(min(var(--scroll-y, 0), 500) * -0.03px))' }}
        >
          <picture>
            <source srcSet={shotDark} media="(prefers-color-scheme: dark)" />
            <img src={shotView} width={1280} height={800} alt="Opendeck showing a slide with a chart next to the slide list" />
          </picture>
        </div>
      </div>
    </div>
  )
}

function Showcase() {
  const [tab, setTab] = useState(showcase[0].id)
  const current = showcase.find((s) => s.id === tab)!
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="gap-6">
      <TabsList className="mx-auto h-10 sm:mx-0">
        {showcase.map((s) => (
          <TabsTrigger key={s.id} value={s.id} className="px-4">{s.label}</TabsTrigger>
        ))}
      </TabsList>
      <div className="grid items-center gap-6 md:grid-cols-[1fr_1.6fr] md:gap-10">
        <div key={current.id} className="animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none">
          <h3 className="text-xl font-semibold tracking-tight">{current.title}</h3>
          <p className="mt-2 text-muted-foreground">{current.text}</p>
        </div>
        <div className="relative aspect-[16/10] overflow-hidden rounded-xl border bg-muted shadow-sm">
          {showcase.map((s) => (
            <img
              key={s.id}
              src={s.shot}
              alt={s.alt}
              loading="lazy"
              className={cn(
                'absolute inset-0 size-full object-cover transition-opacity duration-500 motion-reduce:transition-none',
                s.id === tab ? 'opacity-100' : 'opacity-0',
              )}
            />
          ))}
        </div>
      </div>
    </Tabs>
  )
}

function SectionHead({ title, sub }: { title: string; sub: React.ReactNode }) {
  return (
    <Reveal className="mb-8 max-w-2xl">
      <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-muted-foreground">{sub}</p>
    </Reveal>
  )
}

export function Site() {
  const { progress, scrolled } = useScroll()
  const active = useActiveSection(SECTIONS)
  const section = 'border-t py-16'
  const wrap = 'mx-auto max-w-5xl px-5'

  return (
    <TooltipProvider delay={150}>
      <Progress value={progress} aria-label="Reading progress" className="scroll-progress fixed inset-x-0 top-0 z-50 gap-0" />
      <Header scrolled={scrolled} active={progress < 4 ? '' : active} />

      <main id="top">
        <Hero />

        <section id="features" className={section}>
          <div className={wrap}>
            <SectionHead title="Everything you need to read and present a deck" sub="Open a presentation, find what you need, and present it, without installing Office." />
            <Reveal><Showcase /></Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(([title, text], i) => (
                <Reveal key={title} delay={(i % 3) * 80}>
                  <Card className="h-full transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                    <CardHeader>
                      <CardTitle>{title}</CardTitle>
                      <CardDescription>{text}</CardDescription>
                    </CardHeader>
                  </Card>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section id="new" className={section}>
          <div className={wrap}>
            <SectionHead title="What's new" sub={`Version ${pkg.version} is the latest release.`} />
            <div className="grid gap-4 md:grid-cols-3">
              {releases.map((r, i) => (
                <Reveal key={r.version} delay={i * 80}>
                  <Card className="h-full">
                    <CardHeader>
                      <Badge variant="secondary" className="w-fit">v{r.version}</Badge>
                      <CardTitle>{r.title}</CardTitle>
                      <CardDescription>{r.text}</CardDescription>
                    </CardHeader>
                  </Card>
                </Reveal>
              ))}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Every change is listed on the <a className="underline underline-offset-4" href={`${REPO}/releases`}>Releases page</a>.
            </p>
          </div>
        </section>

        <section id="how" className={section}>
          <div className={wrap}>
            <SectionHead title="How it works" sub="A presentation file is a zip of XML. Opendeck unpacks it and draws every slide itself, inside your browser." />
            <ol className="grid gap-4 md:grid-cols-3">
              {steps.map(([title, text], i) => (
                <li key={title} className="list-none">
                  <Reveal delay={i * 90} className="h-full">
                    <div className="h-full rounded-xl border p-5">
                      <span className="mb-3 grid size-7 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                      <h3 className="font-medium">{title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{text}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
            <Reveal className="mt-6">
              <figure className="rounded-xl border bg-muted p-5">
                <svg viewBox="0 0 760 150" role="img" aria-label="Your file is read and drawn inside your browser. Nothing leaves your device." className="block h-auto w-full text-foreground">
                  <g fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="10" y="40" width="150" height="70" rx="10" />
                    <rect x="230" y="14" width="320" height="122" rx="10" strokeDasharray="5 5" />
                    <rect x="250" y="44" width="86" height="62" rx="8" />
                    <rect x="352" y="44" width="86" height="62" rx="8" />
                    <rect x="454" y="44" width="86" height="62" rx="8" />
                    <rect x="610" y="40" width="140" height="70" rx="10" />
                    <path d="M160 75h70M550 75h60" />
                    <path d="M222 69l8 6-8 6M602 69l8 6-8 6" />
                  </g>
                  <g fill="currentColor" fontSize="14" textAnchor="middle" fontFamily="inherit">
                    <text x="85" y="80">.pptx file</text>
                    <text x="293" y="80">Unzip</text>
                    <text x="395" y="80">Read</text>
                    <text x="497" y="80">Draw</text>
                    <text x="680" y="80">Slides</text>
                    <text x="390" y="130" fontSize="12" opacity="0.7">inside your browser</text>
                  </g>
                </svg>
                <figcaption className="mt-3 text-sm text-muted-foreground">There is no server in this picture. That is the point.</figcaption>
              </figure>
            </Reveal>
          </div>
        </section>

        <section id="privacy" className={section}>
          <div className={wrap}>
            <SectionHead title="Private by design" sub={<>The short version. The full policy is in <a className="underline underline-offset-4" href={`${REPO}/blob/master/PRIVACY.md`}>PRIVACY.md</a>.</>} />
            <ul className="grid gap-3">
              {privacy.map((p, i) => (
                <li key={p} className="list-none">
                  <Reveal delay={i * 70}>
                    <div className="flex gap-3">
                      <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground">✓</span>
                      <span>{p}</span>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="support" className={section}>
          <div className={wrap}>
            <SectionHead title="Support" sub="Something looks wrong, or you have an idea? Open an issue on GitHub. It takes a minute, and everyone can see the answer." />
            <Reveal>
              <div className="flex flex-wrap gap-2.5">
                <Button size="lg" className="h-10 px-4" nativeButton={false} render={<a href={`${REPO}/issues/new?template=bug.yml`} />}>Report a problem</Button>
                <Button size="lg" variant="outline" className="h-10 px-4" nativeButton={false} render={<a href={`${REPO}/issues/new?template=feature.yml`} />}>Suggest a feature</Button>
                <Button size="lg" variant="ghost" className="h-10 px-4" nativeButton={false} render={<a href={`${REPO}/issues`} />}>
                  Browse open issues <ExternalLink />
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">You need a free GitHub account. Please do not attach private presentations; a small example that shows the problem is enough.</p>
            </Reveal>
            <Reveal className="mt-10">
              <h3 id="faq" className="mb-2 text-lg font-semibold">Common questions</h3>
              <Accordion>
                {faq.map(([q, a], i) => (
                  <AccordionItem key={q} value={`q${i}`}>
                    <AccordionTrigger className="py-3 text-base">{q}</AccordionTrigger>
                    <AccordionContent className="max-w-2xl text-muted-foreground">{a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-sm text-muted-foreground">
        <div className={cn(wrap, 'grid gap-3')}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a className="hover:text-foreground" href={REPO}>Source on GitHub</a>
            <a className="hover:text-foreground" href={`${REPO}/blob/master/PRIVACY.md`}>Privacy policy</a>
            <a className="hover:text-foreground" href={`${REPO}/blob/master/LICENSE`}>MIT licence</a>
            <a className="hover:text-foreground" href={`${REPO}/releases`}>Releases</a>
          </div>
          <Separator />
          <p>PowerPoint is a trademark of Microsoft Corporation. Opendeck is an independent project and is not affiliated with or endorsed by Microsoft.</p>
        </div>
      </footer>
    </TooltipProvider>
  )
}
