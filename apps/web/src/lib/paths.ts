/** A path inside this app ("/management/..."), never another site ("//host", "/\host") or a scheme ("https:", "javascript:"). */
export const isAppPath = (link: string) => /^\/(?![/\\])/.test(link)
