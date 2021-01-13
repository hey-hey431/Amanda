declare module "taihou" {
	class Taihou {
		constructor(token: string, wolken: boolean, options?: ConstructorOptions);

		public axios: any;
		public token: string;
		public options: ConstructorOptions;

		public korra: any;
		public shimakaze: any;
		public toph: any;
		public tama: any;

		public imageGeneration: Taihou["korra"];
		public reputation: Taihou["shimakaze"];
		public images: Taihou["toph"];
		public settings: Taihou["tama"];
	}
	export = Taihou;

	interface TaihouOptions {
		userAgent: string;
		baseURL?: string;
		timeout?: number;
		headers?: {
			[header: string]: string | number | symbol;
		};
	}

	interface PerServiceOptions {
		toph?: TaihouOptions;
		images?: TaihouOptions;
		korra?: TaihouOptions;
		imageGeneration?: TaihouOptions;
		shimakaze?: TaihouOptions;
		reputation?: TaihouOptions;
		tama?: TaihouOptions;
		settings?: TaihouOptions;
	}

	type ConstructorOptions = TaihouOptions & PerServiceOptions;
}
