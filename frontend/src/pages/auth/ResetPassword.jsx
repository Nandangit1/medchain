import { Navigate } from "react-router-dom";

/**
 * Password reset is now done with an emailed 6-digit code on the
 * forgot-password page. Old reset links from earlier emails land here and are
 * sent to that page.
 */
const ResetPassword = () => <Navigate to="/forgot-password" replace />;

export default ResetPassword;
