const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const PREFIX = "test-data/";
const FILE_COUNT = 550;
const REGION = process.env.AWS_REGION || "us-east-1";

const s3Client = new S3Client({ region: REGION });

const SAMPLE_SSNS = [
  "123-45-6789",
  "987-65-4321",
  "555-12-3456",
  "111-22-3333",
  "999-88-7777",
];

const SAMPLE_CREDIT_CARDS = [
  "4532015112830366",
  "5425233430109903",
  "374245455400126",
  "6011111111111117",
  "4916338506082832",
];

const SAMPLE_AWS_KEYS = [
  "AKIAIOSFODNN7EXAMPLE",
  "AKIAI44QH8DHBEXAMPLE",
  "AKIAIY5Y2WCIEXAMPLE",
  "AKIAJKLMNOPQRSTUVWXY",
  "AKIAZABCDEFGHIJKLMNO",
];

const SAMPLE_EMAILS = [
  "john.doe@example.com",
  "jane.smith@company.com",
  "admin@sensitive.org",
  "user123@test.com",
  "contact@business.net",
];

const SAMPLE_PHONES = [
  "555-123-4567",
  "(555) 987-6543",
  "555.456.7890",
  "5551234567",
  "1-555-999-8888",
];

const FILE_EXTENSIONS = [".txt", ".csv", ".json", ".log"];

function generateRandomText(size) {
  const words = [
    "Lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "consectetur",
    "adipiscing",
    "elit",
    "sed",
    "do",
    "eiusmod",
    "tempor",
    "incididunt",
    "ut",
    "labore",
    "et",
    "dolore",
    "magna",
    "aliqua",
    "enim",
    "ad",
    "minim",
    "veniam",
    "quis",
  ];

  const sentences = [];
  const targetWords = Math.floor(size / 6); // Rough estimate

  for (let i = 0; i < targetWords; i++) {
    sentences.push(words[Math.floor(Math.random() * words.length)]);
  }

  return sentences.join(" ");
}

function generateFileContent(includeSensitive, extension, size) {
  let content = "";

  if (extension === ".json") {
    const data = {
      timestamp: new Date().toISOString(),
      records: [],
    };

    const recordCount = Math.floor(size / 100);
    for (let i = 0; i < recordCount; i++) {
      const record = {
        id: i + 1,
        text: generateRandomText(50),
      };

      if (includeSensitive && Math.random() > 0.5) {
        if (Math.random() > 0.5) {
          record.ssn =
            SAMPLE_SSNS[Math.floor(Math.random() * SAMPLE_SSNS.length)];
        }
        if (Math.random() > 0.5) {
          record.email =
            SAMPLE_EMAILS[Math.floor(Math.random() * SAMPLE_EMAILS.length)];
        }
      }

      data.records.push(record);
    }

    content = JSON.stringify(data, null, 2);
  } else if (extension === ".csv") {
    content = "id,name,email,phone,notes\n";
    const rowCount = Math.floor(size / 80);

    for (let i = 0; i < rowCount; i++) {
      const row = [
        i + 1,
        `User ${i + 1}`,
        includeSensitive && Math.random() > 0.6
          ? SAMPLE_EMAILS[Math.floor(Math.random() * SAMPLE_EMAILS.length)]
          : "redacted@example.com",
        includeSensitive && Math.random() > 0.6
          ? SAMPLE_PHONES[Math.floor(Math.random() * SAMPLE_PHONES.length)]
          : "xxx-xxx-xxxx",
        generateRandomText(30),
      ];
      content += row.join(",") + "\n";
    }
  } else if (extension === ".log") {
    const lineCount = Math.floor(size / 100);

    for (let i = 0; i < lineCount; i++) {
      const timestamp = new Date(
        Date.now() - Math.random() * 86400000
      ).toISOString();
      const level = ["INFO", "WARN", "ERROR", "DEBUG"][
        Math.floor(Math.random() * 4)
      ];
      let message = generateRandomText(50);

      if (includeSensitive && Math.random() > 0.7) {
        message += ` AWS_ACCESS_KEY_ID=${
          SAMPLE_AWS_KEYS[Math.floor(Math.random() * SAMPLE_AWS_KEYS.length)]
        }`;
      }

      content += `${timestamp} [${level}] ${message}\n`;
    }
  } else {
    content = generateRandomText(size / 2);

    if (includeSensitive) {
      const insertions = Math.floor(Math.random() * 5) + 1;
      for (let i = 0; i < insertions; i++) {
        const type = Math.floor(Math.random() * 5);
        let insertion = "";

        switch (type) {
          case 0:
            insertion = `\nSSN: ${
              SAMPLE_SSNS[Math.floor(Math.random() * SAMPLE_SSNS.length)]
            }\n`;
            break;
          case 1:
            insertion = `\nCredit Card: ${
              SAMPLE_CREDIT_CARDS[
                Math.floor(Math.random() * SAMPLE_CREDIT_CARDS.length)
              ]
            }\n`;
            break;
          case 2:
            insertion = `\nEmail: ${
              SAMPLE_EMAILS[Math.floor(Math.random() * SAMPLE_EMAILS.length)]
            }\n`;
            break;
          case 3:
            insertion = `\nPhone: ${
              SAMPLE_PHONES[Math.floor(Math.random() * SAMPLE_PHONES.length)]
            }\n`;
            break;
          case 4:
            insertion = `\nAWS Key: ${
              SAMPLE_AWS_KEYS[
                Math.floor(Math.random() * SAMPLE_AWS_KEYS.length)
              ]
            }\n`;
            break;
        }

        const pos = Math.floor(Math.random() * content.length);
        content = content.slice(0, pos) + insertion + content.slice(pos);
      }
    }
  }

  return content;
}

async function uploadFile(key, content) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: content,
    ContentType: "text/plain",
  });

  await s3Client.send(command);
}

async function main() {
  if (!BUCKET_NAME) {
    console.error("Error: S3_BUCKET_NAME environment variable is required");
    console.error(
      "Usage: S3_BUCKET_NAME=your-bucket-name node upload-test-files.js"
    );
    process.exit(1);
  }

  console.log("=== S3 Test File Upload Script ===");
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Prefix: ${PREFIX}`);
  console.log(`Files to create: ${FILE_COUNT}`);
  console.log("");

  let uploadedCount = 0;
  let withSensitiveData = 0;

  for (let i = 0; i < FILE_COUNT; i++) {
    const includeSensitive = Math.random() < 0.3;
    if (includeSensitive) withSensitiveData++;

    const size = Math.floor(Math.random() * 499000) + 1000;

    const extension =
      FILE_EXTENSIONS[Math.floor(Math.random() * FILE_EXTENSIONS.length)];

    const fileName = `file-${String(i + 1).padStart(4, "0")}${extension}`;
    const key = PREFIX + fileName;

    const content = generateFileContent(includeSensitive, extension, size);

    try {
      await uploadFile(key, content);
      uploadedCount++;

      if (uploadedCount % 50 === 0) {
        console.log(`Uploaded ${uploadedCount} files...`);
      }
    } catch (error) {
      console.error(`Error uploading ${key}:`, error.message);
    }
  }

  console.log("");
  console.log("=== Upload Complete ===");
  console.log(`Total files uploaded: ${uploadedCount}`);
  console.log(`Files with sensitive data: ${withSensitiveData}`);
  console.log(
    `Files without sensitive data: ${uploadedCount - withSensitiveData}`
  );
  console.log("");
  console.log("You can now run a scan with:");
  console.log(
    `curl -X POST <API_URL>/scan -H "Content-Type: application/json" -d '{"bucket":"${BUCKET_NAME}","prefix":"${PREFIX}"}'`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
