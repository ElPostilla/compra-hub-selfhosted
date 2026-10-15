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
