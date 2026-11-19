const link = 'text-xs font-semibold text-indigo-600 hover:underline'

/**
 * Opens Faculty Uploads on either tab. Always shown (the dialog has its own
 * empty states), so assignments can be reached even before any study
 * material is uploaded.
 */
export function UploadsLinks({ onOpen }: { onOpen: (tab: 'materials' | 'assignments') => void }) {
  return (
    <span className="flex items-center gap-3">
      <button type="button" onClick={() => onOpen('assignments')} className={link}>Assignments</button>
      <button type="button" onClick={() => onOpen('materials')} className={link}>View all</button>
    </span>
  )
}
