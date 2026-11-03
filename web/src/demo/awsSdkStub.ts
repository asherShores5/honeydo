// Stands in for @aws-sdk/client-dynamodb and @aws-sdk/lib-dynamodb in the web build (see the
// alias in vite.config.ts). The demo runs api/src/handler.ts on the in-memory FakeDocClient,
// which only needs the command classes to carry `input`; the real SDK would add hundreds of KB
// and can never be used from the browser anyway.
class Command<I = any> {
  constructor(public input: I) {}
}
export class GetCommand extends Command {}
export class PutCommand extends Command {}
export class UpdateCommand extends Command {}
export class DeleteCommand extends Command {}
export class QueryCommand extends Command {}
export class TransactWriteCommand extends Command {}

const unavailable = { send: () => Promise.reject(new Error("DynamoDB is not available in the demo")) };
export class DynamoDBClient {}
export const DynamoDBDocumentClient = { from: () => unavailable };
