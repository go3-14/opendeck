// Optional host access: the service worker can only fetch a downloaded
// presentation from its URL if the user has granted access to websites. It is
// asked for here, from a button, instead of at install time.

const origins = ['<all_urls>']

const api = typeof chrome !== 'undefined' ? chrome.permissions : undefined

/** False when the page is not running as an extension (for example the dev server). */
export const permissionsSupported = !!api

export const hasDownloadAccess = (): Promise<boolean> => (api ? api.contains({ origins }) : Promise.resolve(false))

/** Must be called directly from a click handler (Chrome requires a user gesture). */
export const requestDownloadAccess = (): Promise<boolean> => (api ? api.request({ origins }) : Promise.resolve(false))

export const removeDownloadAccess = (): Promise<boolean> => (api ? api.remove({ origins }) : Promise.resolve(false))
