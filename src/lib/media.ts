/**
 * Which files open in a viewer rather than the text editor.
 *
 * The extension list is only a fast path. The authoritative rule lives in the
 * store: if a file cannot be read as text, it opens in the viewer regardless of
 * its extension — otherwise every format missing from this list becomes a dead
 * "cannot open binary file".
 */
const MEDIA_EXT =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|tiff?|heics?|heif|jxl|jfif|pjpeg|apng|svgz?|mp4|m4v|webm|mov|mkv|avi|ogv|mpe?g|3gp|flv|wmv|mp3|wav|m4a|aac|flac|ogg|oga|opus|aiff?|wma|mid|midi|amr|pdf|woff2?|ttf|otf|eot|zip|gz|bz2|xz|7z|rar|tar|dmg|pkg|wasm|so|dylib|exe|dll|class|jar|sqlite|db|bin|dat)$/i

export const isMediaPath = (path: string) => MEDIA_EXT.test(path)
