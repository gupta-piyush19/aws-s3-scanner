/**
 * Sensitive Data Detectors
 * Implements regex-based detection for various types of sensitive data
 */

// Detector patterns
const DETECTORS = {
  SSN: {
    name: "SSN",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    contextKeywords: [
      "ssn",
      "social security",
      "social-security",
      "ss#",
      "ss #",
    ],
    mask: (match) => `***-**-${match.slice(-4)}`,
    validate: null,
  },

  CREDIT_CARD: {
    name: "CREDIT_CARD",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    contextKeywords: [
      "card",
      "credit",
      "visa",
      "mastercard",
      "amex",
      "discover",
      "payment",
    ],
    mask: (match) => `****-****-****-${match.replace(/\D/g, "").slice(-4)}`,
    validate: luhnCheck,
  },

  AWS_ACCESS_KEY: {
    name: "AWS_ACCESS_KEY",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    contextKeywords: null, // AWS keys don't need context
    mask: (match) => `AKIA****************`,
    validate: null,
  },

  AWS_SECRET_KEY: {
    name: "AWS_SECRET_KEY",
    pattern: /\b([A-Za-z0-9/+=]{40})\b/g,
    contextKeywords: ["secret", "aws_secret", "secret_access_key"],
    mask: (match) => `************************************${match.slice(-4)}`,
    validate: null,
  },

  EMAIL: {
    name: "EMAIL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    contextKeywords: null, // Email pattern is specific enough
    mask: (match) => {
      const [user, domain] = match.split("@");
      return `${user.slice(0, 2)}***@${domain}`;
    },
    validate: null,
  },

  US_PHONE: {
    name: "US_PHONE",
    patterns: [
      /\b\d{3}-\d{3}-\d{4}\b/g, // 555-555-5555
      /\b\(\d{3}\)\s*\d{3}-\d{4}\b/g, // (555) 555-5555
      /\b\d{3}\.\d{3}\.\d{4}\b/g, // 555.555.5555
      /\b\d{10}\b/g, // 5555555555
      /\b1-\d{3}-\d{3}-\d{4}\b/g, // 1-555-555-5555
    ],
    contextKeywords: ["phone", "tel", "telephone", "mobile", "cell"],
    mask: (match) => {
      const digits = match.replace(/\D/g, "");
      return `***-***-${digits.slice(-4)}`;
    },
    validate: null,
  },
};

/**
 * Luhn algorithm for credit card validation
 * @param {string} cardNumber - Card number string (may contain spaces/dashes)
 * @returns {boolean} - True if valid card number
 */
function luhnCheck(cardNumber) {
  // Remove all non-digit characters
  const digits = cardNumber.replace(/\D/g, "");

  // Must be 13-19 digits
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let isEven = false;

  // Loop through values starting from the rightmost digit
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i]);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Get context around a match (surrounding text)
 * @param {string} content - Full content
 * @param {number} matchIndex - Index of the match
 * @param {number} contextSize - Characters before and after (default: 50)
 * @returns {string} - Context string
 */
function getContext(content, matchIndex, contextSize = 50) {
  const start = Math.max(0, matchIndex - contextSize);
  const end = Math.min(content.length, matchIndex + contextSize);
  return content.slice(start, end).replace(/\n/g, " ").trim();
}

/**
 * Check if context contains relevant keywords
 * @param {string} context - Context string
 * @param {Array<string>} keywords - Keywords to search for
 * @returns {boolean} - True if any keyword found
 */
function hasContextKeywords(context, keywords) {
  if (!keywords || keywords.length === 0) {
    return true; // No keywords required
  }

  const lowerContext = context.toLowerCase();
  return keywords.some((keyword) =>
    lowerContext.includes(keyword.toLowerCase())
  );
}

/**
 * Scan content for sensitive data
 * @param {string} content - File content to scan
 * @param {string} bucket - S3 bucket name
 * @param {string} key - S3 object key
 * @param {string} etag - S3 object ETag
 * @param {string} jobId - Job ID
 * @returns {Array} - Array of findings
 */
function scanContent(content, bucket, key, etag, jobId) {
  const findings = [];

  // SSN Detection
  let matches = content.matchAll(DETECTORS.SSN.pattern);
  for (const match of matches) {
    const context = getContext(content, match.index, 100);
    if (hasContextKeywords(context, DETECTORS.SSN.contextKeywords)) {
      findings.push({
        job_id: jobId,
        bucket,
        key,
        etag,
        detector: DETECTORS.SSN.name,
        masked_match: DETECTORS.SSN.mask(match[0]),
        context: context.substring(0, 500), // Limit context size
        byte_offset: match.index,
      });
    }
  }

  // Credit Card Detection
  matches = content.matchAll(DETECTORS.CREDIT_CARD.pattern);
  for (const match of matches) {
    if (
      DETECTORS.CREDIT_CARD.validate &&
      DETECTORS.CREDIT_CARD.validate(match[0])
    ) {
      const context = getContext(content, match.index, 100);
      if (hasContextKeywords(context, DETECTORS.CREDIT_CARD.contextKeywords)) {
        findings.push({
          job_id: jobId,
          bucket,
          key,
          etag,
          detector: DETECTORS.CREDIT_CARD.name,
          masked_match: DETECTORS.CREDIT_CARD.mask(match[0]),
          context: context.substring(0, 500),
          byte_offset: match.index,
        });
      }
    }
  }

  // AWS Access Key Detection
  matches = content.matchAll(DETECTORS.AWS_ACCESS_KEY.pattern);
  for (const match of matches) {
    findings.push({
      job_id: jobId,
      bucket,
      key,
      etag,
      detector: DETECTORS.AWS_ACCESS_KEY.name,
      masked_match: DETECTORS.AWS_ACCESS_KEY.mask(match[0]),
      context: getContext(content, match.index, 100).substring(0, 500),
      byte_offset: match.index,
    });
  }

  // AWS Secret Key Detection (with context)
  matches = content.matchAll(DETECTORS.AWS_SECRET_KEY.pattern);
  for (const match of matches) {
    const context = getContext(content, match.index, 100);
    if (hasContextKeywords(context, DETECTORS.AWS_SECRET_KEY.contextKeywords)) {
      findings.push({
        job_id: jobId,
        bucket,
        key,
        etag,
        detector: DETECTORS.AWS_SECRET_KEY.name,
        masked_match: DETECTORS.AWS_SECRET_KEY.mask(match[0]),
        context: context.substring(0, 500),
        byte_offset: match.index,
      });
    }
  }

  // Email Detection
  matches = content.matchAll(DETECTORS.EMAIL.pattern);
  for (const match of matches) {
    findings.push({
      job_id: jobId,
      bucket,
      key,
      etag,
      detector: DETECTORS.EMAIL.name,
      masked_match: DETECTORS.EMAIL.mask(match[0]),
      context: getContext(content, match.index, 100).substring(0, 500),
      byte_offset: match.index,
    });
  }

  // US Phone Detection
  for (const pattern of DETECTORS.US_PHONE.patterns) {
    matches = content.matchAll(pattern);
    for (const match of matches) {
      const context = getContext(content, match.index, 100);
      if (hasContextKeywords(context, DETECTORS.US_PHONE.contextKeywords)) {
        findings.push({
          job_id: jobId,
          bucket,
          key,
          etag,
          detector: DETECTORS.US_PHONE.name,
          masked_match: DETECTORS.US_PHONE.mask(match[0]),
          context: context.substring(0, 500),
          byte_offset: match.index,
        });
      }
    }
  }

  return findings;
}

module.exports = {
  scanContent,
  luhnCheck,
};
