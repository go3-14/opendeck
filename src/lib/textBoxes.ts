/** One painted word, recorded while a slide is drawn (see render-canvas.js). */
export interface TextBox {
  str: string
  /** Start of the word's baseline, in the local space of `m`. */
  x: number
  y: number
  /** Painted width of the word (the same unit as x and y). */
  w: number
  size: number
  /** The canvas font string, which is also a valid CSS `font` value. */
  font: string
  /** Canvas transform [a, b, c, d, e, f] in CSS pixels at the render scale. */
  m: [number, number, number, number, number, number]
  /** Words with the same line id sit on one line of one text block. */
  line: number
  /** A space follows this word. */
  sp: boolean
}
