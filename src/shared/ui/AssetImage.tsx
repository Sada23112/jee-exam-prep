import { useEffect, useState } from 'react'
import { workspaceController, errorMessage } from '../../app/workspace-state'
import { formatBytes } from './labels'

export function AssetImage({ assetId, role, pageNumber, onRemove }: {
  assetId: string; role: 'page' | 'crop' | 'diagram'; pageNumber: number | null; onRemove?: () => void
}) {
  const [image, setImage] = useState<{ url: string; name: string; size: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let url: string | null = null
    void workspaceController.getAsset(assetId).then(asset => {
      if (!active) return
      if (!asset) throw new Error('Original image is missing. No substitute was generated.')
      url = URL.createObjectURL(asset.blob)
      setImage({ url, name: asset.name, size: asset.size })
    }).catch(cause => { if (active) setError(errorMessage(cause)) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [assetId])
  return <figure className="asset-card">
    {error ? <p role="alert" className="field-error">{error}</p> : image
      ? <a href={image.url} target="_blank" rel="noopener noreferrer" aria-label={`Open original ${role}: ${image.name}`}><img src={image.url} alt={`Original ${role}${pageNumber ? `, page ${pageNumber}` : ''}`} loading="lazy" /></a>
      : <div className="image-loading" role="status">Loading original image…</div>}
    <figcaption><span><strong>{role === 'page' ? 'Original page' : role === 'crop' ? 'Question crop' : 'Diagram'}</strong>{pageNumber ? ` · Page ${pageNumber}` : ''}<small>{image ? `${image.name} · ${formatBytes(image.size)}` : ''}</small></span>
      {image && <a href={image.url} download={image.name} className="text-link">Download</a>}
      {onRemove && <button type="button" className="text-button danger-text" onClick={onRemove}>Detach</button>}
    </figcaption>
  </figure>
}
