import { Navigate, useParams } from 'react-router-dom';

/**
 * `/connections/:id` is no longer a screen (C05 §11.3): the Connection's server
 * overview is a workspace tab. This sends the route there with an intent that
 * Workspace acts on, which also raises the not-found toast for an unknown id.
 */
export default function ConnectionManager() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to="/workspace" replace state={{ openServer: { connectionId: id } }} />;
}
