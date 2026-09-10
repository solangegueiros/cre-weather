// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/**
 * @title WeatherCRE
 * @notice Request a weather reading for a city via a Chainlink CRE workflow.
 * @dev Deploy on Ethereum Sepolia. Forwarder: 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
 *
 *   User flow:
 *     1. Caller invokes `getWeather(city)` on-chain; this emits `WeatherRequested`.
 *     2. The CRE workflow listens for `WeatherRequested`, fetches weather from
 *        wttr.in, ABI-encodes the result, and writes it back via `onReport`.
 *     3. `onReport` decodes the report and appends a `WeatherReading` to storage.
 *
 *   Inspired by: https://github.com/solangegueiros/chainlink-bootcamp-2024/blob/main/WeatherFunctionsSepolia.sol
 */
contract WeatherCRE {
    struct WeatherReading {
        string city;
        string temperature;
        uint256 timestamp;
        address sender;
    }

    event WeatherRequested(string city, address requester);
    event WeatherStored(string city, string temperature, uint256 timestamp, address sender);
    event ForwarderUpdated(address forwarder);

    // Trusted caller allowed to invoke `onReport`. Set once after deployment to
    // the CRE forwarder address for the target network.
    //
    // Known CRE Forwarder addresses:
    //   - Ethereum Sepolia (testnet): 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
    address public forwarder;
    address public immutable owner;

    WeatherReading[] public readings;
    mapping(address => WeatherReading[]) private readingsByRequester;

    constructor() {
        owner = msg.sender;
        // Default to the Ethereum Sepolia CRE simulation forwarder. Override with
        // `setForwarder` when deploying to a different network.
        //
        // Known CRE forwarder addresses — full directory:
        // https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
        //
        //   Ethereum Sepolia (simulation): 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
        //   Monad Testnet   (simulation): 0xB9F79d863261869B234c481D1f9A7af84AeAd192
        forwarder = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    }

    /// @notice Set the CRE forwarder that is authorized to call `onReport`.
    function setForwarder(address _forwarder) external {
        require(msg.sender == owner, "only owner");
        forwarder = _forwarder;
        emit ForwarderUpdated(_forwarder);
    }

    /**
     * @notice Emits a `WeatherRequested` event for the CRE workflow to pick up.
     * @param city The city name, e.g. "Lisbon", "London", "New York".
     */
    function getWeather(string calldata city) external {
        emit WeatherRequested(city, msg.sender);
    }

    /**
     * @notice Called by the CRE forwarder with an ABI-encoded weather report.
     * @dev Decodes the report and delegates storage to `weatherSet`.
     *      Expected `report` layout:
     *      abi.encode(string city, string temperature, uint256 timestamp, address sender)
     */
    function onReport(bytes calldata /* metadata */, bytes calldata report) external {
        require(msg.sender == forwarder, "only forwarder");

        (string memory city, string memory temperature, uint256 timestamp, address sender) =
            abi.decode(report, (string, string, uint256, address));

        weatherSet(city, temperature, timestamp, sender);
    }

    /**
     * @notice Appends a weather reading to storage and emits `WeatherStored`.
     * @dev Internal so only `onReport` (called by the trusted forwarder) can write.
     */
    function weatherSet(
        string memory city,
        string memory temperature,
        uint256 timestamp,
        address sender
    ) internal {
        WeatherReading memory reading = WeatherReading(city, temperature, timestamp, sender);
        readings.push(reading);
        readingsByRequester[sender].push(reading);

        emit WeatherStored(city, temperature, timestamp, sender);
    }

    /// @notice Total number of readings stored by the contract.
    function getReadingsCount() external view returns (uint256) {
        return readings.length;
    }

    /// @notice Number of readings stored for a specific requester.
    function getReadingsCountByRequester(address requester) external view returns (uint256) {
        return readingsByRequester[requester].length;
    }

    /// @notice Fetch a single reading stored for a requester.
    function getReadingByRequester(address requester, uint256 index)
        external
        view
        returns (WeatherReading memory)
    {
        return readingsByRequester[requester][index];
    }
}
