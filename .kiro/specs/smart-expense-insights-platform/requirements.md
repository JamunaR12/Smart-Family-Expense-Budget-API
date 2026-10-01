# Requirements Document

## Introduction

The Smart Expense Insights Platform is a production-quality expense management API that enables individuals and households to record expenses, organize them by category, set and track budgets, and derive spending analytics and insights. The platform provides secure authentication and enforces strict per-user data isolation so that each account owner can access only their own financial data.

A defining characteristic of the platform is deployment portability: the same codebase MUST run locally as a conventional NestJS + Express HTTP server backed by a local PostgreSQL database, and MUST also be deployable to AWS as an API Gateway → AWS Lambda → NestJS/Express → PostgreSQL (RDS) stack using AWS SAM, without divergent application source code.

This document defines the functional and non-functional requirements only. It intentionally avoids prescribing architecture or implementation approach beyond the technology and deployment constraints explicitly stated by the requestor, which are captured in the Constraints section.

## Glossary

- **Platform**: The complete Smart Expense Insights Platform API and its supporting services.
- **API**: The HTTP interface exposed by the Platform through which clients interact.
- **Auth_Service**: The Platform component responsible for user registration, credential verification, and issuance and validation of authentication tokens.
- **Authorization_Service**: The Platform component responsible for enforcing access control and per-user data isolation on each request.
- **Expense_Service**: The Platform component responsible for create, read, update, and delete operations on expense records.
- **Category_Service**: The Platform component responsible for managing expense categories.
- **Budget_Service**: The Platform component responsible for managing budgets and evaluating spending against budgets.
- **Analytics_Service**: The Platform component responsible for computing spending analytics and insights.
- **Validation_Service**: The Platform component responsible for validating incoming request payloads and parameters.
- **Logging_Service**: The Platform component responsible for recording structured operational and audit log entries.
- **User**: A registered account holder who authenticates to access the Platform.
- **Account_Owner**: The User to whom a given data record (expense, category, budget) belongs.
- **Authentication_Token**: A signed, time-limited credential issued by the Auth_Service that a client presents to prove identity on subsequent requests.
- **Expense**: A record of a single monetary outflow, including amount, currency, date, category, and optional description.
- **Category**: A named grouping used to classify expenses (for example, "Groceries" or "Utilities").
- **Budget**: A monetary limit defined by a User for a specified period and optionally scoped to a Category.
- **Budget_Period**: The time interval over which a Budget applies (for example, a calendar month).
- **Spending_Insight**: A computed summary describing spending behavior over a time range, by month or by category.
- **Data_Isolation**: The property that a User can access, modify, or delete only records for which that User is the Account_Owner.
- **Runtime_Environment**: The execution context in which the Platform runs, either the local server environment or the AWS Lambda environment.
- **Configuration_Source**: The set of environment-provided values that supply runtime settings such as database connection details and token signing secrets.

## Constraints

These constraints are stated by the requestor and are recorded here to bound the design. They are not derived requirements and do not prescribe internal architecture.

- **C1**: The Platform implementation SHALL use Node.js and TypeScript.
- **C2**: The Platform SHALL be built on the NestJS framework using the Express HTTP adapter.
- **C3**: The Platform SHALL use PostgreSQL as its relational data store and Prisma as its data access layer.
- **C4**: The Platform SHALL be deployable to AWS using AWS Lambda, API Gateway, and AWS SAM.
- **C5**: The same application codebase SHALL support both local execution as a NestJS + Express HTTP server and AWS Lambda execution behind API Gateway, without maintaining divergent application source code per Runtime_Environment.
- **C6**: In the AWS Runtime_Environment, the Platform SHALL connect to a PostgreSQL database provided by Amazon RDS.

## Assumptions

- **A1**: Each User account is owned and operated by a single authenticated principal; household sharing of a single account among multiple people is treated as shared use of one Account_Owner and is out of scope for multi-user shared-account permissions.
- **A2**: Monetary amounts for a given User are recorded in a currency that the User specifies per Expense; currency conversion between currencies is out of scope.
- **A3**: All timestamps and date-based groupings are evaluated in a single, configured time zone for the Platform unless a per-User time zone is later introduced.
- **A4**: Network transport security (TLS termination) is provided by the hosting environment (local reverse proxy or API Gateway) and is available to the Platform.
- **A5**: Client applications consuming the API are responsible for their own user interface; this specification covers the API only.

## Requirements

### Requirement 1: User Registration

**User Story:** As a new user, I want to register an account with my credentials, so that I can securely store and manage my expenses.

#### Acceptance Criteria

1. WHEN a registration request is received with an email address conforming to RFC 5322 syntax and between 3 and 254 characters (inclusive) and a password between 8 and 128 characters (inclusive) that contains at least one uppercase letter, one lowercase letter, one digit, and one special character, THE Auth_Service SHALL create a User account and return a success response identifying the created User.
2. IF a registration request contains an email address that, compared case-insensitively, is already associated with an existing User, THEN THE Auth_Service SHALL reject the request with a conflict error, SHALL NOT create a duplicate User, and SHALL leave the existing User account unchanged.
3. IF a registration request contains an email address that does not conform to RFC 5322 syntax or is fewer than 3 or more than 254 characters, THEN THE Auth_Service SHALL reject the request with a validation error indicating the email field failed, and SHALL NOT create a User account.
4. IF a registration request contains a password that is fewer than 8 or more than 128 characters, or that lacks at least one uppercase letter, one lowercase letter, one digit, or one special character, THEN THE Auth_Service SHALL reject the request with a validation error indicating the password field failed, and SHALL NOT create a User account.
5. WHEN the Auth_Service stores a User password, THE Auth_Service SHALL store only a salted cryptographic hash of the password using a unique per-user salt, and SHALL NOT store the plaintext password.

### Requirement 2: User Login and Authentication

**User Story:** As a registered user, I want to log in with my credentials, so that I can obtain an authenticated session to access my data.

#### Acceptance Criteria

1. WHEN a login request is received with an email and password matching an existing User, THE Auth_Service SHALL issue an Authentication_Token bound to that User within 2 seconds.
2. IF a login request is received with an email that has no matching User or a password that does not match the stored hash, THEN THE Auth_Service SHALL reject the request with an authentication error that does not disclose which field was incorrect.
3. IF a login request is received with a missing or empty email field or a missing or empty password field, THEN THE Auth_Service SHALL reject the request with a validation error indicating that required credentials are missing, without attempting credential verification.
4. THE Auth_Service SHALL set an expiration time of 3600 seconds from the time of issuance on every issued Authentication_Token.
5. WHEN a request presents an Authentication_Token whose expiration time has passed, THE Auth_Service SHALL reject the request with an authentication error.
6. IF a request presents a malformed or unverifiable Authentication_Token, THEN THE Auth_Service SHALL reject the request with an authentication error.
7. IF 5 consecutive failed login attempts occur for the same email within a 15-minute window, THEN THE Auth_Service SHALL reject subsequent login requests for that email with an authentication error indicating the account is temporarily locked, for a lockout duration of 900 seconds.

### Requirement 3: Authorization and User-Specific Data Isolation

**User Story:** As a user, I want my financial data to be accessible only to me, so that my personal information stays private.

#### Acceptance Criteria

1. WHEN a request targets an Expense, Category, or Budget resource, THE Authorization_Service SHALL permit the operation within 500 milliseconds only where the authenticated User is the Account_Owner of the targeted resource.
2. IF an authenticated User requests a resource for which that User is not the Account_Owner, THEN THE Authorization_Service SHALL reject the request, SHALL return a response indicating the request is not authorized, SHALL NOT disclose the contents or existence of the resource, and SHALL leave the targeted resource unchanged.
3. WHEN the Expense_Service, Category_Service, Budget_Service, or Analytics_Service returns a collection of records, THE Authorization_Service SHALL restrict the returned records to only those for which the authenticated User is the Account_Owner, and SHALL return an empty collection when no such records exist.
4. IF a request that requires authentication is received without an Authentication_Token, THEN THE Authorization_Service SHALL reject the request, SHALL return a response indicating that authentication is required, and SHALL NOT perform the requested operation.
5. IF a request that requires authentication is received with an Authentication_Token that is expired, malformed, or otherwise invalid, THEN THE Authorization_Service SHALL reject the request, SHALL return a response indicating that authentication failed, and SHALL NOT perform the requested operation.

### Requirement 4: Expense Creation

**User Story:** As a user, I want to record an expense, so that I can keep track of my spending.

#### Acceptance Criteria

1. WHEN an authenticated User submits an expense with a numeric amount greater than 0.00 and less than or equal to 999,999,999.99 with exactly two decimal places, a currency, a date, and a valid Category reference, THE Expense_Service SHALL create an Expense owned by that User and return the created Expense with a unique identifier within 3 seconds.
2. IF an expense creation request contains an amount that is zero, negative, non-numeric, or exceeds 999,999,999.99, THEN THE Validation_Service SHALL reject the request with a validation error indicating the amount is out of range, and SHALL NOT create the Expense.
3. IF an expense creation request references a Category that does not exist or is not owned by the requesting User, THEN THE Expense_Service SHALL reject the request with a validation error indicating the Category is invalid, and SHALL NOT create the Expense.
4. IF an expense creation request omits a required field among amount, currency, date, or Category reference, THEN THE Validation_Service SHALL reject the request with a validation error identifying each missing field by name, and SHALL NOT create the Expense.
5. IF an expense creation request contains a currency value that is not a recognized 3-letter currency code, or a date that is not a valid calendar date or is later than the current date, THEN THE Validation_Service SHALL reject the request with a validation error identifying the invalid field, and SHALL NOT create the Expense.
6. WHERE an expense creation request includes an optional description of at most 500 characters, THE Expense_Service SHALL store the description with the created Expense.

### Requirement 5: Expense Retrieval

**User Story:** As a user, I want to view my expenses, so that I can review my spending history.

#### Acceptance Criteria

1. WHEN an authenticated User requests a single Expense by identifier for which that User is the Account_Owner, THE Expense_Service SHALL return the Expense.
2. WHEN an authenticated User requests a list of expenses without filters, THE Expense_Service SHALL return the expenses for which that User is the Account_Owner, ordered by expense date from most recent to least recent.
3. WHERE a list request specifies a date range with a start date and an end date, THE Expense_Service SHALL return only expenses whose date is on or after the start date and on or before the end date (inclusive of both boundaries).
4. WHERE a list request specifies a Category filter, THE Expense_Service SHALL return only expenses that are assigned to the specified Category and for which the requesting User is the Account_Owner.
5. WHERE a list request specifies pagination parameters, THE Expense_Service SHALL return results limited to the requested page size (between 1 and 100 items, defaulting to 20 when omitted) starting at the requested offset (0 or greater, defaulting to 0 when omitted).
6. WHEN a list request matches no expenses, THE Expense_Service SHALL return an empty list.
7. IF an authenticated User requests an Expense identifier that does not exist, THEN THE Expense_Service SHALL respond with a not-found error indicating the requested Expense does not exist.
8. IF an authenticated User requests a single Expense for which that User is not the Account_Owner, THEN THE Expense_Service SHALL deny the request with an error indicating the User is not authorized to access the Expense, and SHALL NOT return the Expense contents.
9. IF an unauthenticated request is made to retrieve any Expense or list of expenses, THEN THE Expense_Service SHALL reject the request with an error indicating authentication is required, and SHALL NOT return any Expense data.
10. IF a list request specifies a pagination parameter, a date range, or a Category filter that is malformed or out of the accepted range, THEN THE Expense_Service SHALL reject the request with an error indicating which parameter is invalid, and SHALL NOT return any expenses.

### Requirement 6: Expense Update

**User Story:** As a user, I want to edit an expense I recorded, so that I can correct mistakes.

#### Acceptance Criteria

1. WHEN an authenticated User submits an update to an Expense for which that User is the Account_Owner with an amount between 0.01 and 999,999,999.99 (inclusive) expressed with at most two decimal places and a description of at most 500 characters, THE Expense_Service SHALL apply the changes and return the updated Expense within 3 seconds.
2. IF an update request contains an amount that is zero, negative, non-numeric, greater than 999,999,999.99, or specified with more than two decimal places, THEN THE Validation_Service SHALL reject the request with a validation error indicating the invalid amount and SHALL leave the stored Expense unchanged.
3. IF an update request contains a description that exceeds 500 characters, THEN THE Validation_Service SHALL reject the request with a validation error indicating the description length limit and SHALL leave the stored Expense unchanged.
4. IF an update request references a Category that does not exist or is not owned by the requesting User, THEN THE Expense_Service SHALL reject the request with a validation error indicating the invalid Category and SHALL leave the stored Expense unchanged.
5. IF a User submits an update for an Expense identifier that does not exist, THEN THE Expense_Service SHALL respond with a not-found error and SHALL make no changes to any stored Expense.
6. IF an authenticated User submits an update to an Expense for which that User is not the Account_Owner, THEN THE Expense_Service SHALL reject the request with an authorization error indicating the User is not permitted to modify the Expense and SHALL leave the stored Expense unchanged.

### Requirement 7: Expense Deletion

**User Story:** As a user, I want to delete an expense, so that I can remove records I no longer want.

#### Acceptance Criteria

1. WHEN an authenticated User requests deletion of an existing Expense for which that User is the Account_Owner, THE Expense_Service SHALL remove the Expense and return a confirmation response within 2 seconds.
2. IF a User requests deletion of an Expense identifier that does not exist or is not a valid identifier format, THEN THE Expense_Service SHALL respond with a not-found error indicating the Expense identifier was not found and SHALL make no changes to stored Expense records.
3. IF a User requests deletion of an existing Expense for which that User is not the Account_Owner, THEN THE Expense_Service SHALL respond with an authorization error indicating the User lacks permission and SHALL retain the Expense unchanged.
4. WHEN an Expense is successfully deleted, THE Analytics_Service SHALL exclude the deleted Expense from all Spending_Insight computations performed after the deletion completes.

### Requirement 8: Expense Category Management

**User Story:** As a user, I want to organize my expenses into categories, so that I can understand where my money goes.

#### Acceptance Criteria

1. WHEN an authenticated User creates a Category with a name that is 1 to 100 characters long after trimming leading and trailing whitespace and that is unique (case-insensitive) among that User's categories, THE Category_Service SHALL create the Category owned by that User and return the created Category.
2. IF an authenticated User creates or updates a Category with a name that is empty or contains only whitespace after trimming, or that exceeds 100 characters after trimming, THEN THE Category_Service SHALL reject the request with a validation error indicating the name constraint that was violated and SHALL NOT create or modify any Category.
3. IF a User creates a Category with a name that already exists (case-insensitive, after trimming) among that User's categories, THEN THE Category_Service SHALL reject the request with a conflict error and SHALL NOT create the Category.
4. WHEN an authenticated User requests a list of categories, THE Category_Service SHALL return the categories owned by that User, returning an empty list when that User owns no categories.
5. WHEN an authenticated User who is the Account_Owner of a Category updates its name to a value that is 1 to 100 characters long after trimming and unique (case-insensitive) among that User's categories, THE Category_Service SHALL apply the change and return the updated Category.
6. IF a User requests an update or deletion of a Category that does not exist or that the User is not the Account_Owner of, THEN THE Category_Service SHALL reject the request with an authorization or not-found error and SHALL NOT modify or remove any Category.
7. IF a User requests deletion of a Category that is referenced by one or more existing expenses, THEN THE Category_Service SHALL reject the deletion with a conflict error describing the dependency and SHALL retain the Category.
8. WHEN an authenticated User who is the Account_Owner of a Category deletes that Category and it is referenced by no expenses, THE Category_Service SHALL remove the Category and return a confirmation response.

### Requirement 9: Budget Management

**User Story:** As a user, I want to set budgets for a period or category, so that I can plan and control my spending.

#### Acceptance Criteria

1. WHEN an authenticated User creates a Budget with a limit amount from 0.01 to 999,999,999.99 (up to 2 decimal places) and a Budget_Period equal to one of "weekly", "monthly", or "yearly", THE Budget_Service SHALL create the Budget owned by that User within 2 seconds and return the created Budget.
2. WHERE a Budget creation request specifies a Category, THE Budget_Service SHALL scope the Budget to expenses assigned to that Category.
3. IF a Budget creation request specifies a limit amount that is less than 0.01, greater than 999,999,999.99, non-numeric, or has more than 2 decimal places, THEN THE Validation_Service SHALL reject the request without creating the Budget and return a validation error indicating the invalid limit amount.
4. IF a Budget creation request specifies a Budget_Period that is not one of "weekly", "monthly", or "yearly", THEN THE Validation_Service SHALL reject the request without creating the Budget and return a validation error indicating the invalid Budget_Period.
5. IF a Budget creation request references a Category that is not owned by the requesting User, THEN THE Budget_Service SHALL reject the request without creating the Budget and return a validation error indicating the Category is not accessible.
6. WHEN an authenticated User requests a list of budgets, THE Budget_Service SHALL return the budgets owned by that User.
7. WHEN an authenticated User who is the Account_Owner of a Budget updates that Budget with a valid limit amount and Budget_Period, THE Budget_Service SHALL apply the change and return a confirmation response.
8. WHEN an authenticated User who is the Account_Owner of a Budget deletes that Budget, THE Budget_Service SHALL remove the Budget and return a confirmation response.
9. IF an authenticated User attempts to update or delete a Budget for which that User is not the Account_Owner, THEN THE Budget_Service SHALL reject the request without applying any change and return an authorization error indicating the User is not permitted to modify the Budget.

### Requirement 10: Budget Tracking

**User Story:** As a user, I want to see how my spending compares to my budgets, so that I know whether I am staying within my limits.

#### Acceptance Criteria

1. WHEN an authenticated User requests the status of an existing Budget, THE Budget_Service SHALL return the Budget limit, the total amount of the User's expenses within the Budget_Period and Budget scope, the remaining amount computed as Budget limit minus total spending, and the Budget status, within 2 seconds.
2. WHILE the total spending within a Budget_Period and Budget scope is greater than or equal to 0 and less than or equal to the Budget limit, THE Budget_Service SHALL report the Budget status as within-limit and SHALL report a remaining amount greater than or equal to 0.
3. IF the total spending within a Budget_Period and Budget scope exceeds the Budget limit, THEN THE Budget_Service SHALL report the Budget status as exceeded and SHALL report the exceeded amount computed as total spending minus Budget limit.
4. IF an authenticated User requests the status of a Budget that does not exist or is not owned by the requesting User, THEN THE Budget_Service SHALL reject the request and SHALL return an error indicating the Budget was not found or is not accessible, without returning any Budget data.
5. WHEN an authenticated User requests the status of a Budget for which no expenses exist within the Budget_Period and Budget scope, THE Budget_Service SHALL report total spending as 0, remaining amount equal to the Budget limit, and Budget status as within-limit.

### Requirement 11: Spending Analytics and Insights

**User Story:** As a user, I want monthly and category-based insights into my spending, so that I can understand and adjust my financial habits.

#### Acceptance Criteria

1. WHEN an authenticated User requests a monthly spending insight for a specified month, THE Analytics_Service SHALL return within 3 seconds the total amount of that User's expenses dated within the specified month, computed as the arithmetic sum of the amounts of all included expenses.
2. WHEN an authenticated User requests a category-based spending insight for a specified time range, THE Analytics_Service SHALL return within 3 seconds the total amount of that User's expenses grouped by Category within the specified time range, where each group total equals the arithmetic sum of the amounts of the expenses in that Category.
3. THE Analytics_Service SHALL compute Spending_Insight values only from expenses for which the requesting User is the Account_Owner.
4. WHERE a User has no expenses matching the requested time range or grouping, THE Analytics_Service SHALL return a Spending_Insight with all totals equal to zero and SHALL NOT return an error.
5. WHEN the Analytics_Service computes a Spending_Insight over a set of expenses, THE Analytics_Service SHALL produce a total equal to the arithmetic sum of the amounts of the included expenses, with each amount in the range 0.01 to 999,999,999.99.
6. IF a User requests a spending insight for which the specified month or time range is missing, malformed, or has a start date later than its end date, THEN THE Analytics_Service SHALL reject the request and return an error indicating the requested time range is invalid, without computing any Spending_Insight.

### Requirement 12: Request Validation

**User Story:** As a user, I want the API to validate my requests, so that invalid data is rejected clearly instead of causing corrupt records.

#### Acceptance Criteria

1. WHEN a request payload is received, THE Validation_Service SHALL validate each field against its defined data type, format, and value constraints (including minimum and maximum length, numeric range, and required-field presence) before the request reaches a business operation.
2. IF a request payload fails validation, THEN THE Validation_Service SHALL reject the request without persisting or modifying any record, and SHALL return a validation error that identifies each failing field and the reason for each failure.
3. IF a request contains one or more fields not defined for the target operation, THEN THE Validation_Service SHALL reject the request without persisting or modifying any record, and SHALL return a validation error that identifies each unrecognized field.
4. IF a required field is absent or contains a null value, THEN THE Validation_Service SHALL reject the request with a validation error that identifies each missing required field.
5. WHEN the Validation_Service completes validation of a request payload, THE Validation_Service SHALL complete validation within 500 milliseconds for a payload containing up to 100 fields.

### Requirement 13: Error Handling

**User Story:** As a user, I want errors to be reported consistently, so that I can understand and recover from problems.

#### Acceptance Criteria

1. WHEN the API returns an error, THE Platform SHALL return a response containing a machine-readable error code and a human-readable message of at most 500 characters in a consistent structure that is identical in field names and format across all endpoints.
2. IF an unexpected internal failure occurs during request processing, THEN THE Platform SHALL return a generic error response that contains only an error code and human-readable message, and SHALL exclude stack traces, database details, file paths, and secret values from the response.
3. WHEN the Platform returns an error response, THE Platform SHALL set an HTTP status code in the 4xx range for client-caused errors and in the 5xx range for server-caused errors.
4. IF a request fails validation of its input, THEN THE Platform SHALL return an error response identifying each field that failed validation and the reason for each failure, without modifying any stored data.
5. IF an unexpected internal failure occurs during request processing, THEN THE Platform SHALL roll back any partial changes made during that request so that no partial or inconsistent data is persisted.

### Requirement 14: Logging and Observability

**User Story:** As an operator, I want the Platform to produce structured logs, so that I can monitor behavior and diagnose issues.

#### Acceptance Criteria

1. WHEN the Platform processes a request, THE Logging_Service SHALL record a structured log entry containing the request method, target route, response status, a correlation identifier, and a timestamp with millisecond precision.
2. WHEN the Logging_Service records a log entry, THE Logging_Service SHALL assign a severity level from the set (DEBUG, INFO, WARN, ERROR).
3. IF an error occurs during request processing, THEN THE Logging_Service SHALL record a structured log entry with severity ERROR containing the error category, the correlation identifier, and the target route.
4. WHEN the Logging_Service records a log entry, THE Logging_Service SHALL exclude plaintext passwords, Authentication_Token values, and other secret values from every field of the log entry.
5. IF a log entry field would contain a plaintext password, an Authentication_Token value, or another secret value, THEN THE Logging_Service SHALL replace that value with a fixed redaction placeholder and record the remaining fields.
6. WHEN the Platform processes a request that does not include a correlation identifier, THE Logging_Service SHALL generate a unique correlation identifier and include it in all log entries for that request.

### Requirement 15: Environment-Based Configuration

**User Story:** As an operator, I want runtime settings to come from environment configuration, so that I can run the Platform in different environments without code changes.

#### Acceptance Criteria

1. WHEN the Platform starts, THE Platform SHALL read database connection settings, token signing secrets, and environment-specific settings from the Configuration_Source before accepting any incoming requests.
2. IF a required configuration value is absent, empty, or contains only whitespace at startup, THEN THE Platform SHALL terminate startup within 30 seconds without accepting any incoming requests.
3. IF a required configuration value is absent, empty, or contains only whitespace at startup, THEN THE Platform SHALL emit a startup error identifying each missing configuration value by its configuration key name.
4. THE Platform SHALL read secret configuration values from the Configuration_Source rather than from source code.
5. IF a configuration value is present but fails format validation for its expected type, THEN THE Platform SHALL terminate startup without accepting requests and emit an error identifying the invalid configuration key and the expected value type.

### Requirement 16: Deployment Portability

**User Story:** As an operator, I want to run the same codebase locally and on AWS, so that I avoid maintaining separate implementations.

#### Acceptance Criteria

1. WHERE the Runtime_Environment is local, THE Platform SHALL run as a NestJS application using the Express HTTP adapter listening on a configured port and connecting to a local PostgreSQL database.
2. WHERE the Runtime_Environment is local, IF the configured port is unavailable or already in use, THEN THE Platform SHALL abort startup and emit a startup error indicating the port binding failure.
3. WHERE the Runtime_Environment is AWS Lambda, THE Platform SHALL handle requests routed from API Gateway to the same NestJS application and SHALL connect to a PostgreSQL database provided by Amazon RDS.
4. WHERE the Runtime_Environment is either local or AWS Lambda, IF the PostgreSQL database connection cannot be established within 10 seconds, THEN THE Platform SHALL reject the affected request with an error response indicating database unavailability and SHALL leave persisted data unchanged.
5. THE Platform SHALL expose equivalent API behavior across the local and AWS Lambda Runtime_Environments from a single application codebase, such that for identical requests the response status, response body structure, and validation outcomes are identical in both environments.
6. THE Platform SHALL be deployable to AWS using AWS SAM.

### Requirement 17: Automated Testing

**User Story:** As a developer, I want automated tests, so that I can verify correctness and prevent regressions.

#### Acceptance Criteria

1. THE Platform SHALL include an automated test suite that is executable through a single documented command.
2. WHEN the automated test suite is executed, THE Platform SHALL complete the full test run and produce a summary reporting the total number of tests executed, the number passed, and the number failed.
3. THE automated test suite SHALL include at least one test for each of the following functional areas: authentication, expense create operations, expense read operations, expense update operations, expense delete operations, category management, budget tracking, and analytics computation.
4. WHEN an authentication, authorization, or data-isolation rule is defined, THE automated test suite SHALL include a test verifying that a request by one User to access another User's data is rejected and returns no data belonging to the other User.
5. FOR ALL sets of expenses used in an analytics computation test, THE automated test suite SHALL verify that a computed monthly total or category total equals the arithmetic sum of the included expense amounts, with equality evaluated to a tolerance of 0.01 currency units.
6. IF one or more tests in the automated test suite fail, THEN THE Platform SHALL exit with a non-zero status code and report each failing test identifier in the run summary.

### Requirement 18: API Documentation

**User Story:** As a consumer of the API, I want documentation of the endpoints, so that I can integrate with the Platform.

#### Acceptance Criteria

1. THE Platform SHALL provide documentation that, for each API endpoint, describes the endpoint path, the supported request method, each request parameter with its name and data type, the request body schema with each field's name and data type, and the response schema with each field's name and data type.
2. THE Platform SHALL provide documentation that, for each API endpoint, describes the success response representation and at least one failure response representation, including for each response an indication of whether it denotes success or failure.
3. WHEN an endpoint is added, THE Platform documentation SHALL include an entry for that endpoint describing its request parameters, request body schema, and response schema within the same release in which the endpoint becomes available.
4. WHEN an existing endpoint's request or response contract changes, THE Platform documentation SHALL be updated to describe the current request parameters, request body schema, and response schema within the same release in which the contract change becomes available.
5. IF a consumer requests documentation for an endpoint that does not exist, THEN THE Platform SHALL return a response indicating that no documentation is available for the requested endpoint.
