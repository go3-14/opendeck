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
