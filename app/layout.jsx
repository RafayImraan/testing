import "./styles.css";
import "./theme.css";

export const metadata = {
  title: "TestTrace — Quality, in focus",
  description: "A focused workspace for test management, execution, and traceability."
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
