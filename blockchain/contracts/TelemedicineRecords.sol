// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  TelemedicineRecords
 * @notice Tamper-evident registry for medical record metadata and the access
 *         rights attached to it.
 *
 * @dev    WHAT THIS CONTRACT DELIBERATELY DOES NOT STORE
 *
 *         No medical file, no file name, no patient name, no diagnosis text —
 *         nothing that identifies a human being. Blockchain data is permanent
 *         and world-readable, which makes it the worst possible place for
 *         clinical content.
 *
 *         What is stored is the minimum needed to make the off-chain system
 *         provable:
 *           - `contentHash`  SHA-256 of the PLAINTEXT document
 *           - `cid`          IPFS content identifier of the CIPHERTEXT
 *           - who owns it, who uploaded it, and when
 *           - every grant and revocation of access, as events
 *
 *         A patient can therefore prove that the document they hold today is
 *         byte-identical to the one anchored at block N, and an auditor can
 *         reconstruct the complete access history without ever being able to
 *         read a single report.
 *
 *         KEY LINKAGE: `profileRef` is keccak256 of the off-chain MongoDB user
 *         id. It lets the backend correlate a wallet with an account without
 *         publishing the id itself.
 */
contract TelemedicineRecords is AccessControl, Pausable, ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @notice Platform administrator. Verifies doctors, pauses the contract.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @notice The backend service key. Registers participants and anchors records.
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    /**
     * @notice Permits granting access on a patient's behalf.
     * @dev    COMPATIBILITY PATH, NOT THE DEFAULT. The intended flow is that a
     *         patient signs `grantAccess` with their own wallet, which is what
     *         makes "the patient owns their data" cryptographically true.
     *         `grantAccessFor` exists so the platform remains usable for
     *         patients who have no wallet. It is a SEPARATE role precisely so
     *         it can be revoked in production:
     *
     *             contract.revokeRole(CUSTODIAN_ROLE, backendAddress)
     *
     *         Every custodial grant emits `AccessGranted` with `custodial=true`,
     *         so the audit trail always distinguishes the two.
     */
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum ParticipantRole {
        None,
        Patient,
        Doctor
    }

    struct Participant {
        ParticipantRole role;
        bool active;
        bool verified; // meaningful for doctors only
        uint64 registeredAt;
        bytes32 profileRef;
    }

    struct Record {
        address patient;
        address uploadedBy;
        bytes32 contentHash;
        uint8 recordType;
        uint64 createdAt;
        bool active;
        string cid;
    }

    struct Grant {
        bool granted;
        uint64 grantedAt;
        uint64 expiresAt; // 0 means it never expires
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    mapping(address => Participant) private _participants;

    /// @dev Record ids are 1-based; id 0 is reserved to mean "does not exist".
    mapping(uint256 => Record) private _records;
    uint256 private _recordCount;

    mapping(address => uint256[]) private _patientRecordIds;
    mapping(uint256 => mapping(address => Grant)) private _grants;

    /// @dev Mirrors the backend's per-patient duplicate check.
    mapping(address => mapping(bytes32 => bool)) private _patientHashSeen;

    // ---------------------------------------------------------------------
    // Events — the audit trail
    // ---------------------------------------------------------------------

    event PatientRegistered(address indexed patient, bytes32 indexed profileRef, uint64 timestamp);
    event DoctorRegistered(address indexed doctor, bytes32 indexed profileRef, uint64 timestamp);
    event DoctorVerified(address indexed doctor, address indexed verifiedBy, uint64 timestamp);
    event DoctorVerificationRevoked(address indexed doctor, address indexed revokedBy, uint64 timestamp);
    event ParticipantDeactivated(address indexed account, address indexed by, uint64 timestamp);

    event RecordAnchored(
        uint256 indexed recordId,
        address indexed patient,
        address indexed uploadedBy,
        bytes32 contentHash,
        string cid,
        uint8 recordType,
        uint64 timestamp
    );
    event RecordDeactivated(uint256 indexed recordId, address indexed patient, uint64 timestamp);

    event AccessGranted(
        uint256 indexed recordId,
        address indexed patient,
        address indexed doctor,
        uint64 expiresAt,
        bool custodial,
        uint64 timestamp
    );
    event AccessRevoked(
        uint256 indexed recordId,
        address indexed patient,
        address indexed doctor,
        uint64 timestamp
    );

    /// @notice Emitted when a granted viewer actually reads a record.
    event AccessLogged(uint256 indexed recordId, address indexed viewer, uint64 timestamp);

    // ---------------------------------------------------------------------
    // Errors — cheaper than require strings and easier to test against
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error EmptyCid();
    error ZeroHash();
    error AlreadyRegistered(address account);
    error NotRegistered(address account);
    error NotAPatient(address account);
    error NotADoctor(address account);
    error DoctorNotVerified(address doctor);
    error ParticipantInactive(address account);
    error RecordNotFound(uint256 recordId);
    error RecordInactive(uint256 recordId);
    error NotRecordOwner(address caller, uint256 recordId);
    error DuplicateContentHash(address patient, bytes32 contentHash);
    error ExpiryInThePast(uint64 expiresAt);
    error CannotGrantToSelf();
    error AccessNotGranted(uint256 recordId, address doctor);

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /**
     * @param admin     Receives DEFAULT_ADMIN_ROLE and ADMIN_ROLE.
     * @param registrar The backend service wallet. Also receives CUSTODIAN_ROLE,
     *                  which should be revoked once patients hold their own keys.
     */
    constructor(address admin, address registrar) {
        if (admin == address(0) || registrar == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);
        _grantRole(CUSTODIAN_ROLE, registrar);
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier recordExists(uint256 recordId) {
        if (recordId == 0 || recordId > _recordCount) revert RecordNotFound(recordId);
        _;
    }

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    function registerPatient(address patient, bytes32 profileRef)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
    {
        _register(patient, profileRef, ParticipantRole.Patient);
        emit PatientRegistered(patient, profileRef, uint64(block.timestamp));
    }

    function registerDoctor(address doctor, bytes32 profileRef)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
    {
        _register(doctor, profileRef, ParticipantRole.Doctor);
        emit DoctorRegistered(doctor, profileRef, uint64(block.timestamp));
    }

    function _register(address account, bytes32 profileRef, ParticipantRole role) private {
        if (account == address(0)) revert ZeroAddress();
        if (profileRef == bytes32(0)) revert ZeroHash();
        if (_participants[account].role != ParticipantRole.None) revert AlreadyRegistered(account);

        _participants[account] = Participant({
            role: role,
            active: true,
            verified: false, // doctors start unverified; patients ignore this flag
            registeredAt: uint64(block.timestamp),
            profileRef: profileRef
        });
    }

    /**
     * @notice Mirrors the off-chain admin verification from Module 2.
     * @dev    An unverified doctor can never be granted access to a record.
     */
    function verifyDoctor(address doctor) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Participant storage participant = _participants[doctor];

        if (participant.role == ParticipantRole.None) revert NotRegistered(doctor);
        if (participant.role != ParticipantRole.Doctor) revert NotADoctor(doctor);
        if (!participant.active) revert ParticipantInactive(doctor);

        participant.verified = true;
        emit DoctorVerified(doctor, msg.sender, uint64(block.timestamp));
    }

    function revokeDoctorVerification(address doctor) external onlyRole(ADMIN_ROLE) {
        Participant storage participant = _participants[doctor];

        if (participant.role != ParticipantRole.Doctor) revert NotADoctor(doctor);

        participant.verified = false;
        emit DoctorVerificationRevoked(doctor, msg.sender, uint64(block.timestamp));
    }

    function deactivateParticipant(address account) external onlyRole(ADMIN_ROLE) {
        Participant storage participant = _participants[account];

        if (participant.role == ParticipantRole.None) revert NotRegistered(account);

        participant.active = false;
        emit ParticipantDeactivated(account, msg.sender, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Records
    // ---------------------------------------------------------------------

    /**
     * @notice Anchors one medical record's fingerprint on-chain.
     * @param  patient     Owner of the record.
     * @param  contentHash SHA-256 of the plaintext document.
     * @param  cid         IPFS CID of the encrypted payload.
     * @param  recordType  Numeric mirror of the backend's record-type enum.
     * @return recordId    1-based identifier, stored back in MongoDB.
     */
    function anchorRecord(
        address patient,
        bytes32 contentHash,
        string calldata cid,
        uint8 recordType
    ) external onlyRole(REGISTRAR_ROLE) whenNotPaused nonReentrant returns (uint256 recordId) {
        Participant storage owner = _participants[patient];

        if (owner.role == ParticipantRole.None) revert NotRegistered(patient);
        if (owner.role != ParticipantRole.Patient) revert NotAPatient(patient);
        if (!owner.active) revert ParticipantInactive(patient);
        if (contentHash == bytes32(0)) revert ZeroHash();
        if (bytes(cid).length == 0) revert EmptyCid();
        if (_patientHashSeen[patient][contentHash]) revert DuplicateContentHash(patient, contentHash);

        unchecked {
            recordId = ++_recordCount; // cannot realistically overflow uint256
        }

        _records[recordId] = Record({
            patient: patient,
            uploadedBy: msg.sender,
            contentHash: contentHash,
            recordType: recordType,
            createdAt: uint64(block.timestamp),
            active: true,
            cid: cid
        });

        _patientRecordIds[patient].push(recordId);
        _patientHashSeen[patient][contentHash] = true;

        emit RecordAnchored(
            recordId,
            patient,
            msg.sender,
            contentHash,
            cid,
            recordType,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Marks a record inactive. Mirrors the backend's soft delete.
     * @dev    The record and its history remain on-chain forever — that is the
     *         point of an audit trail. Only the active flag changes.
     */
    function deactivateRecord(uint256 recordId) external recordExists(recordId) whenNotPaused {
        Record storage record = _records[recordId];

        if (record.patient != msg.sender && !hasRole(REGISTRAR_ROLE, msg.sender)) {
            revert NotRecordOwner(msg.sender, recordId);
        }
        if (!record.active) revert RecordInactive(recordId);

        record.active = false;
        emit RecordDeactivated(recordId, record.patient, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Access control over records
    // ---------------------------------------------------------------------

    /**
     * @notice Patient-signed grant. This is the primary, intended path.
     * @param  expiresAt Unix seconds, or 0 for a grant that never expires.
     */
    function grantAccess(uint256 recordId, address doctor, uint64 expiresAt)
        external
        recordExists(recordId)
        whenNotPaused
    {
        Record storage record = _records[recordId];
        if (record.patient != msg.sender) revert NotRecordOwner(msg.sender, recordId);

        _grantAccess(recordId, record.patient, doctor, expiresAt, false);
    }

    /**
     * @notice Custodial grant, for patients who hold no wallet.
     * @dev    See CUSTODIAN_ROLE. Emits `custodial=true` so the audit trail
     *         always shows that the platform, not the patient, signed this.
     */
    function grantAccessFor(uint256 recordId, address doctor, uint64 expiresAt)
        external
        onlyRole(CUSTODIAN_ROLE)
        recordExists(recordId)
        whenNotPaused
    {
        _grantAccess(recordId, _records[recordId].patient, doctor, expiresAt, true);
    }

    function _grantAccess(
        uint256 recordId,
        address patient,
        address doctor,
        uint64 expiresAt,
        bool custodial
    ) private {
        Record storage record = _records[recordId];
        if (!record.active) revert RecordInactive(recordId);

        if (doctor == address(0)) revert ZeroAddress();
        if (doctor == patient) revert CannotGrantToSelf();
        if (expiresAt != 0 && expiresAt <= uint64(block.timestamp)) revert ExpiryInThePast(expiresAt);

        Participant storage viewer = _participants[doctor];
        if (viewer.role == ParticipantRole.None) revert NotRegistered(doctor);
        if (viewer.role != ParticipantRole.Doctor) revert NotADoctor(doctor);
        if (!viewer.active) revert ParticipantInactive(doctor);
        if (!viewer.verified) revert DoctorNotVerified(doctor);

        _grants[recordId][doctor] = Grant({
            granted: true,
            grantedAt: uint64(block.timestamp),
            expiresAt: expiresAt
        });

        emit AccessGranted(recordId, patient, doctor, expiresAt, custodial, uint64(block.timestamp));
    }

    function revokeAccess(uint256 recordId, address doctor)
        external
        recordExists(recordId)
    {
        Record storage record = _records[recordId];

        // Revocation stays available while paused: withdrawing consent must
        // never be blocked by an operational emergency stop.
        if (record.patient != msg.sender && !hasRole(CUSTODIAN_ROLE, msg.sender)) {
            revert NotRecordOwner(msg.sender, recordId);
        }

        Grant storage grant = _grants[recordId][doctor];
        if (!grant.granted) revert AccessNotGranted(recordId, doctor);

        delete _grants[recordId][doctor];
        emit AccessRevoked(recordId, record.patient, doctor, uint64(block.timestamp));
    }

    /**
     * @notice The authorisation oracle the backend consults before decrypting.
     * @dev    Returns false for inactive records, unverified or deactivated
     *         doctors, and expired grants. The patient always passes.
     */
    function hasAccess(uint256 recordId, address viewer) public view returns (bool) {
        if (recordId == 0 || recordId > _recordCount) return false;

        Record storage record = _records[recordId];
        if (!record.active) return false;
        if (record.patient == viewer) return true;

        Grant storage grant = _grants[recordId][viewer];
        if (!grant.granted) return false;
        if (grant.expiresAt != 0 && grant.expiresAt <= uint64(block.timestamp)) return false;

        Participant storage participant = _participants[viewer];
        return participant.active && participant.verified;
    }

    /**
     * @notice Records that a viewer actually read a record.
     * @dev    Called by the backend after a successful decrypt. Reverts if the
     *         viewer was not entitled, so the log cannot be forged to imply a
     *         legitimate read that never happened.
     */
    function logAccess(uint256 recordId, address viewer)
        external
        onlyRole(REGISTRAR_ROLE)
        recordExists(recordId)
    {
        if (!hasAccess(recordId, viewer)) revert AccessNotGranted(recordId, viewer);
        emit AccessLogged(recordId, viewer, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getRecord(uint256 recordId)
        external
        view
        recordExists(recordId)
        returns (Record memory)
    {
        return _records[recordId];
    }

    /**
     * @dev View-only and therefore unbounded iteration is acceptable here; it
     *      costs the caller nothing. Never call this from a state-changing
     *      function.
     */
    function getPatientRecordIds(address patient) external view returns (uint256[] memory) {
        return _patientRecordIds[patient];
    }

    function getParticipant(address account) external view returns (Participant memory) {
        return _participants[account];
    }

    function getGrant(uint256 recordId, address doctor) external view returns (Grant memory) {
        return _grants[recordId][doctor];
    }

    function recordCount() external view returns (uint256) {
        return _recordCount;
    }

    /**
     * @notice Confirms a document matches what was anchored.
     * @param  contentHash SHA-256 of the plaintext the caller currently holds.
     */
    function verifyRecordIntegrity(uint256 recordId, bytes32 contentHash)
        external
        view
        recordExists(recordId)
        returns (bool)
    {
        return _records[recordId].contentHash == contentHash;
    }

    function isVerifiedDoctor(address account) external view returns (bool) {
        Participant storage participant = _participants[account];
        return
            participant.role == ParticipantRole.Doctor && participant.active && participant.verified;
    }

    // ---------------------------------------------------------------------
    // Emergency stop
    // ---------------------------------------------------------------------

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
}
