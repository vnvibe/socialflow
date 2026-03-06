import { ThumbsUp, MessageCircle, Share2, Globe } from 'lucide-react'

export default function PostPreview({ username, avatar, caption, media }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 max-w-lg overflow-hidden">
      {/* Post header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        {avatar ? (
          <img
            src={avatar}
            alt={username}
            className="w-10 h-10 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
            {(username || 'U').charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {username || 'Username'}
          </p>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            Just now &middot;{' '}
            <Globe className="w-3 h-3" />
          </p>
        </div>
      </div>

      {/* Caption */}
      {caption && (
        <div className="px-4 py-2">
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{caption}</p>
        </div>
      )}

      {/* Media */}
      {media && (
        <div className="mt-1">
          {typeof media === 'string' ? (
            <img
              src={media}
              alt="Post media"
              className="w-full max-h-96 object-cover"
            />
          ) : Array.isArray(media) && media.length > 0 ? (
            <div
              className={`grid gap-0.5 ${
                media.length === 1
                  ? 'grid-cols-1'
                  : media.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-2'
              }`}
            >
              {media.slice(0, 4).map((src, i) => (
                <div key={i} className="relative">
                  <img
                    src={src}
                    alt={`Media ${i + 1}`}
                    className="w-full h-48 object-cover"
                  />
                  {i === 3 && media.length > 4 && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-white text-xl font-bold">
                        +{media.length - 4}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Engagement bar */}
      <div className="px-4 py-2 border-t border-gray-100 mt-2">
        <div className="flex items-center justify-between">
          <button className="flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors py-2 px-3 rounded-lg hover:bg-gray-50 text-sm">
            <ThumbsUp className="w-4 h-4" />
            Like
          </button>
          <button className="flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors py-2 px-3 rounded-lg hover:bg-gray-50 text-sm">
            <MessageCircle className="w-4 h-4" />
            Comment
          </button>
          <button className="flex items-center gap-2 text-gray-500 hover:text-blue-600 transition-colors py-2 px-3 rounded-lg hover:bg-gray-50 text-sm">
            <Share2 className="w-4 h-4" />
            Share
          </button>
        </div>
      </div>
    </div>
  )
}
