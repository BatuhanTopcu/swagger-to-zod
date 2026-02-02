export const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return fallbackCopy(text);
  }
};

const fallbackCopy = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
};

export const showFeedback = (element: HTMLElement, success: boolean, message: string): void => {
  const existing = document.querySelector(".swagger-zod-feedback");
  existing?.remove();

  const feedback = document.createElement("div");
  feedback.className = `swagger-zod-feedback ${success ? "success" : "error"}`;
  feedback.textContent = message;

  const rect = element.getBoundingClientRect();
  feedback.style.cssText = `
    position: fixed;
    top: ${rect.top - 30}px;
    left: ${rect.left + rect.width / 2}px;
    transform: translateX(-50%);
  `;

  document.body.appendChild(feedback);
  setTimeout(() => feedback.remove(), 2000);
};
