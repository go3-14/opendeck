// The few glyphs the shadcn components need, inlined so the whole lucide-react
// icon library does not end up in the bundle.
import type { SVGProps } from "react"

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

export const XIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="M20 6 9 17l-5-5" /></svg>
)
export const ChevronRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="m9 18 6-6-6-6" /></svg>
)
export const ChevronDownIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="m6 9 6 6 6-6" /></svg>
)
export const ChevronUpIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="m18 15-6-6-6 6" /></svg>
)
export const DownloadIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="M12 15V3M7 10l5 5 5-5M5 21h14" /></svg>
)
export const ExternalLinkIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
)
export const SunIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const MoonIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
)
export const MonitorIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}><rect width="20" height="14" x="2" y="3" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
)
