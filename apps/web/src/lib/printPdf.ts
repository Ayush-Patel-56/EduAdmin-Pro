/**
 * Prints a PDF made in the browser (jsPDF) without opening a tab: it loads into
 * a hidden frame on this page and that frame's print dialog opens (the site's
 * Content-Security-Policy allows blob: frames for exactly this). A browser that
 * can't print a framed PDF gets the file as a download instead.
 */
export function printPdf(pdf: Blob, fileName: string) {
  const url = URL.createObjectURL(pdf)
  const frame = document.createElement('iframe')
  // Through the DOM, which the Content-Security-Policy allows (style="" in markup it doesn't).
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  frame.setAttribute('aria-hidden', 'true')
  frame.title = fileName
  frame.addEventListener(
    'load',
    () => {
      try {
        frame.contentWindow!.focus()
        frame.contentWindow!.print()
      } catch {
        download(url, fileName)
      }
      // The print dialog can stay open a while; the frame (and its PDF) must outlive it.
      setTimeout(() => {
        frame.remove()
        URL.revokeObjectURL(url)
      }, 60_000)
    },
    { once: true },
  )
  frame.src = url
  document.body.append(frame)
}

function download(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
}
