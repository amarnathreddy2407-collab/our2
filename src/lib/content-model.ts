export type ContentStore = "events" | "memories" | "letters" | "scratch";
type ContentConfig = { table: string; columns: string; photoBucket?: string; videoBucket?: string };

export const CONTENT_CONFIG: Record<ContentStore, ContentConfig> = {
  events: {
    table: "story_milestones",
    columns: "id,title,event_date,description,location,photo_path,photo_url,photo_bucket,published,created_at,updated_at",
    photoBucket: "photos",
  },
  memories: {
    table: "memories",
    columns: "id,photo_path,photo_url,photo_bucket,caption,memory_date,location,fav,rot,video_path,video_url,video_bucket,published,created_at,updated_at",
    photoBucket: "memory-attachments",
    videoBucket: "videos",
  },
  letters: {
    table: "love_letters",
    columns: "id,title,body,letter_date,fav,draft,published,created_at,updated_at",
  },
  scratch: {
    table: "scratch_reveals",
    columns: "id,photo_path,photo_url,photo_bucket,caption,display_order,video_path,video_url,video_bucket,published,created_at,updated_at",
    photoBucket: "photos",
    videoBucket: "videos",
  },
};

export function isContentStore(value: string): value is ContentStore {
  return Object.hasOwn(CONTENT_CONFIG, value);
}
