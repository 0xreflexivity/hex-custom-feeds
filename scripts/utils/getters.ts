const IFlareContractRegistry = artifacts.require("IFlareContractRegistry");
const IFlareSystemsManager = artifacts.require("IFlareSystemsManager");
const IFdcHub = artifacts.require("IFdcHub");
const IRelay = artifacts.require("IRelay");
const IFdcVerification = artifacts.require("IFdcVerification");

const FLARE_CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

export async function getFlareContractRegistry() {
    return await IFlareContractRegistry.at(FLARE_CONTRACT_REGISTRY_ADDRESS);
}

export async function getContractAddressByName(name: string) {
    const flareContractRegistry = await getFlareContractRegistry();
    return await flareContractRegistry.getContractAddressByName(name);
}

export async function getFlareSystemsManager() {
    const address: string = await getContractAddressByName("FlareSystemsManager");
    return await IFlareSystemsManager.at(address);
}

export async function getFdcHub() {
    const address: string = await getContractAddressByName("FdcHub");
    return await IFdcHub.at(address);
}

export async function getRelay() {
    const address: string = await getContractAddressByName("Relay");
    return await IRelay.at(address);
}

export async function getFdcVerification() {
    const address: string = await getContractAddressByName("FdcVerification");
    return await IFdcVerification.at(address);
}
