export interface Profile {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountConsoleUrl: string;
}

export interface Friend {
  friendshipId: string;
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

export interface FriendRequest {
  requestId: string;
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
}

export interface FriendsData {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  listId: string;
  memberCount: number;
  isOwner: boolean;
}

export interface GroupMember {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: 'owner' | 'member';
}

export interface GroupInvite {
  token: string;
  expiresAt: string;
}

export interface InvitePreview {
  groupId: string;
  groupName: string;
  inviterUsername: string;
  inviterFirstName: string | null;
  memberCount: number;
  alreadyMember: boolean;
}

export interface ActivityEntry {
  actorId: string | null;
  actorUsername: string | null;
  message: string;
  createdAt: string;
}
