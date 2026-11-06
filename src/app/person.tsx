// A team member's avatar: their photo when they added one, their initials otherwise. A live workspace keeps the photo as
// a path to a private file, read through a short-lived address (features/settings/image.ts), so it shows everywhere the
// person appears: the top bar, lists, boards, the agenda, tasks, the security pages.
import { Avatar } from '@/ui';
import { useApp } from '@/app/hooks';
import { useStoredImage } from '@/features/settings/image';
import type { TeamUser } from '@/domain/types';

/** `user` when the caller has the record; otherwise the team member is looked up by `id`, then by exact name. */
export function PersonAvatar({ user, id, name, size, accent }: { user?: TeamUser; id?: string; name: string; size?: 'sm'; accent?: boolean }) {
  const { data } = useApp();
  const who = user ?? (id ? data.users.find((u) => u.id === id) : undefined) ?? (name ? data.users.find((u) => u.name === name) : undefined);
  const photo = useStoredImage(who?.photo);
  return <Avatar name={name || who?.name || ''} size={size} accent={accent} photo={photo || undefined} />;
}
