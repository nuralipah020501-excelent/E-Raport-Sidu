import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export interface DriveImageFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  modifiedTime?: string;
  size?: string;
}

export const initDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const signInWithGoogleDrive = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan token akses Google Drive.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const signOutGoogleDrive = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export const getDriveAccessToken = (): string | null => cachedAccessToken;
export const getCurrentDriveUser = (): User | null => auth.currentUser;

export async function listDriveImages(
  accessToken: string,
  searchQuery = '',
  pageToken?: string
): Promise<{ files: DriveImageFile[]; nextPageToken?: string }> {
  const qParts = ["mimeType contains 'image/'", 'trashed = false'];
  if (searchQuery.trim()) {
    const escaped = searchQuery.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${escaped}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields:
      'nextPageToken, files(id, name, mimeType, thumbnailLink, modifiedTime, size)',
    orderBy: 'modifiedTime desc',
    pageSize: '24',
  });

  if (pageToken) {
    params.set('pageToken', pageToken);
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Sesi Google Drive berakhir. Silakan masuk ulang.');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal memuat foto Google Drive (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    files?: DriveImageFile[];
    nextPageToken?: string;
  };
  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

export async function downloadDriveImageBlob(
  accessToken: string,
  fileId: string
): Promise<Blob> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Sesi Google Drive berakhir. Silakan masuk ulang.');
  }

  if (!res.ok) {
    throw new Error(`Gagal mengunduh gambar dari Google Drive (${res.status}).`);
  }

  return await res.blob();
}
